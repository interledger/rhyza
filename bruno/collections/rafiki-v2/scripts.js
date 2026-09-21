const { generateKeyPairSync } = require('crypto');

const scripts = {
  resolveTemplateVariables: function (string) {
    const VARIABLE_NAME_REGEX = /{{([A-Za-z]\w+)}}/g;

    return string.replace(
      VARIABLE_NAME_REGEX,
      (_, key) => bru.getVar(key) || bru.getEnvVar(key)
    );
  },

  sanitizeBody: function () {
    let requestBody = req.getBody();
    if (requestBody === undefined) return undefined;
    if (typeof requestBody === 'object') {
      requestBody = JSON.stringify(requestBody);
    }
    return JSON.parse(this.resolveTemplateVariables(requestBody));
  },

  sanitizeHeaders: function () {
    return JSON.parse(
      this.resolveTemplateVariables(JSON.stringify(req.getHeaders()))
    );
  },

  setHeaders: function (headers) {
    for (const [key, value] of Object.entries(headers)) {
      req.setHeader(key, value);
    }
  },

  requestSigHeaders: async function (url, method, headers, body) {
    const response = await fetch(bru.getEnvVar('httpSignatureServiceUrl'), {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyId: bru.getVar('clientKeyId'),
        base64Key: bru.getVar('clientPrivateKey'),
        request: {
          url,
          method,
          headers,
          body: JSON.stringify(body)
        }
      })
    });
    return await response.json();
  },

  // Directed identity: the client signs with a locally-generated Ed25519 key
  // and includes the public JWK directly in the request body (client.jwk),
  // instead of pointing at a wallet address' /jwks.json.
  generateClientKeys: function () {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
      publicKeyEncoding: { type: 'spki', format: 'jwk' }
    });

    const privateKeyPem =
      '-----BEGIN PRIVATE KEY-----\n' +
      `${privateKey.toString('base64')}\n` +
      '-----END PRIVATE KEY-----\n';

    const jwk = {
      kid: 'bruno-client-key',
      alg: 'EdDSA',
      use: 'sig',
      kty: publicKey.kty,
      crv: publicKey.crv,
      x: publicKey.x
    };

    bru.setVar(
      'clientPrivateKey',
      Buffer.from(privateKeyPem, 'utf-8').toString('base64')
    );
    bru.setVar('clientKeyId', jwk.kid);
    bru.setVar('clientPublicJwk', JSON.stringify(jwk));
  },

  addSignatureHeaders: async function () {
    if (!bru.getVar('clientPrivateKey')) {
      this.generateClientKeys();
    }

    const url = this.resolveTemplateVariables(req.getUrl());
    const headers = this.sanitizeHeaders();
    const body = this.sanitizeBody();
    req.setBody(body);

    const signatureHeaders = await this.requestSigHeaders(
      url,
      req.getMethod(),
      headers,
      body
    );
    this.setHeaders(signatureHeaders);
  }
};

module.exports = scripts;
