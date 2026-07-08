import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PaymentIntent } from '../../src/payment-intent/entity';
import {
  InvalidPaymentAmountError,
  InvalidPaymentIntentExpiryError,
  InvalidQuoteAmountError,
  InvalidQuoteIdError,
  InvalidQuoteStateError,
  MissingFxRateError,
  PaymentIntentExpired,
  PaymentIntentInvalidState,
  QuoteExpiredError,
  PaymentNotFoundError,
  PaymentInvalidStateError,
  InvalidPaymentIdError
} from '../../src/payment-intent/errors';
import { PaymentIntentDestination } from '../../src/payment-intent/interfaces';

describe('PaymentIntent Entity', () => {
  describe('create', () => {
    it('creates successfully', (context) => {
      const now = Date.now();
      context.mock.timers.enable({ apis: ['Date'], now });

      const id = crypto.randomUUID();
      const paymentIntent = PaymentIntent.create(
        id,
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );
      assert.equal(paymentIntent.id, id);
      assert.equal(paymentIntent.state, 'CREATED');
      assert.equal(
        paymentIntent.expiresAt.getTime(),
        new Date(now + 1000 * 60 * 60 * 24 * 30).getTime() // Default expiry is 30 days
      );
    });

    it('throws InvalidPaymentIntentExpiryError if expiry is in the past', () => {
      const pastDate = new Date(Date.now() - 60000).toISOString();
      assert.throws(
        () => {
          PaymentIntent.create(
            crypto.randomUUID(),
            crypto.randomUUID(),
            'receiver',
            PaymentIntentDestination.LOCAL,
            'USD',
            2,
            pastDate
          );
        },
        (err: Error) => {
          assert(err instanceof InvalidPaymentIntentExpiryError);
          assert.match(err.message, /future/);
          return true;
        }
      );
    });

    it('throws InvalidPaymentIntentExpiryError if expiry is > 30 days', () => {
      const farFuture = new Date(
        Date.now() + 1000 * 60 * 60 * 24 * 31
      ).toISOString(); // 31 days
      assert.throws(
        () => {
          PaymentIntent.create(
            crypto.randomUUID(),
            crypto.randomUUID(),
            'receiver',
            PaymentIntentDestination.LOCAL,
            'USD',
            2,
            farFuture
          );
        },
        (err: Error) => {
          assert(err instanceof InvalidPaymentIntentExpiryError);
          assert.match(err.message, /30 days/);
          return true;
        }
      );
    });
  });

  describe('isExpired', () => {
    it('returns false if current time is before expiresAt', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        new Date(Date.now() + 1000 * 60).toISOString()
      );
      assert.equal(paymentIntent.isExpired, false);
    });

    it('returns true if current time is after expiresAt', () => {
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
        quotes: [],
        payments: []
      });

      assert.equal(paymentIntent.isExpired, true);
    });
  });

  describe('addLocalQuote', () => {
    it('adds a quote', (context) => {
      const now = Date.now();
      context.mock.timers.enable({ apis: ['Date'], now });

      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );

      const quoteId = crypto.randomUUID();
      const senderWalletAddressId = crypto.randomUUID();

      paymentIntent.addLocalQuote({
        id: quoteId,
        debitAmount: 200n,
        exchangeRate: 0.5,
        senderWalletAddress: {
          id: senderWalletAddressId,
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      assert.equal(paymentIntent.quotes.length, 1);
      const quote = paymentIntent.quotes[0];
      assert.equal(quote.id, quoteId);
      assert.equal(quote.state, 'COMPLETED');
      assert.equal(quote.receiveAmount, 100n);
      assert.equal(quote.debitAmount, 200n);
      assert.equal(quote.senderWalletAddress, 'sender');
      assert.equal(quote.senderWalletAddressId, senderWalletAddressId);

      const expectedExpiry = new Date(now + 1000 * 60 * 10); // Default quote expiry is 10 mins
      assert.equal(quote.expiresAt?.getTime(), expectedExpiry.getTime());
      assert.ok(quote.expiresAt.getTime() < paymentIntent.expiresAt.getTime());
    });

    it('caps quote expiry at payment intent expiry if intent expires sooner', () => {
      const paymentIntentExpiry = new Date(
        Date.now() + 1000 * 60
      ).toISOString();
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        paymentIntentExpiry
      );

      paymentIntent.addLocalQuote({
        id: crypto.randomUUID(),
        debitAmount: 200n,
        exchangeRate: 0.5,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      assert.equal(paymentIntent.quotes[0].state, 'COMPLETED');
      assert.equal(
        paymentIntent.quotes[0].expiresAt.toISOString(),
        paymentIntentExpiry
      );
    });

    it('throws InvalidQuoteIdError on duplicate quote id', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        new Date(Date.now() + 60_000 * 10).toISOString()
      );

      const quoteArgs = {
        id: crypto.randomUUID(),
        debitAmount: 200n,
        exchangeRate: 0.5,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      };

      paymentIntent.addLocalQuote(quoteArgs);

      assert.throws(
        () => {
          paymentIntent.addLocalQuote(quoteArgs);
        },
        (err: Error) => {
          assert(err instanceof InvalidQuoteIdError);
          assert.match(err.message, /Duplicate quote id/);
          return true;
        }
      );
    });

    it('fails if quote when payment intent is in invalid state', async () => {
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'COMPLETED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        quotes: [],
        payments: []
      });

      assert.throws(
        () => {
          paymentIntent.addLocalQuote({
            id: crypto.randomUUID(),
            debitAmount: 200n,
            exchangeRate: 0.5,
            senderWalletAddress: {
              id: crypto.randomUUID(),
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            }
          });
        },
        (err: Error) => {
          assert(err instanceof PaymentIntentInvalidState);
          assert.match(err.message, /invalid state/);
          return true;
        }
      );
    });

    it('fails if payment intent is expired', async () => {
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000), // in the past
        quotes: [],
        payments: []
      });

      assert.throws(
        () => {
          paymentIntent.addLocalQuote({
            id: crypto.randomUUID(),
            debitAmount: 200n,
            exchangeRate: 0.5,
            senderWalletAddress: {
              id: crypto.randomUUID(),
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            }
          });
        },
        (err: Error) => {
          assert(err instanceof PaymentIntentExpired);
          assert.match(err.message, /expired/);
          return true;
        }
      );
    });

    it('fails if no amounts provided for quote', async () => {
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        quotes: [],
        payments: []
      });

      assert.throws(
        () => {
          paymentIntent.addLocalQuote({
            id: crypto.randomUUID(),
            exchangeRate: 0.5,
            senderWalletAddress: {
              id: crypto.randomUUID(),
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            }
          });
        },
        (err: Error) => {
          assert(err instanceof InvalidQuoteAmountError);
          return true;
        }
      );
    });

    it('successfully creates a quote with receive amount', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );

      const quoteId = crypto.randomUUID();
      paymentIntent.addLocalQuote({
        id: quoteId,
        receiveAmount: 100n,
        exchangeRate: 0.5,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      assert.equal(paymentIntent.quotes.length, 1);
      const quote = paymentIntent.quotes[0];
      assert.equal(quote.id, quoteId);
      assert.equal(quote.state, 'COMPLETED');
      assert.equal(quote.receiveAmount, 100n);
      assert.equal(quote.debitAmount, 200n);
    });

    it('successfully creates quote with incomingAmount from payment intent', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null,
        100n
      );

      const quoteId = crypto.randomUUID();
      paymentIntent.addLocalQuote({
        id: quoteId,
        exchangeRate: 0.5,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      assert.equal(paymentIntent.quotes.length, 1);
      const quote = paymentIntent.quotes[0];
      assert.equal(quote.id, quoteId);
      assert.equal(quote.state, 'COMPLETED');
      assert.equal(quote.receiveAmount, 100n);
      assert.equal(quote.debitAmount, 200n);
    });

    [
      {
        debitAmount: 1n,
        expectedReceiveAmount: 1n,
        exchangeRate: 1,
        description: 'exchange rate = 1'
      },
      {
        debitAmount: 10n,
        expectedReceiveAmount: 14n,
        exchangeRate: 1.4,
        description: 'exchange rate > 1'
      },
      {
        debitAmount: 10n,
        expectedReceiveAmount: 6n,
        exchangeRate: 0.67,
        description: 'exchange rate < 1 (flooring)'
      }
    ].forEach((test) => {
      it(`successfully creates quote with with debitAmount and ${test.description}`, () => {
        const paymentIntent = PaymentIntent.create(
          crypto.randomUUID(),
          crypto.randomUUID(),
          'receiver',
          PaymentIntentDestination.LOCAL,
          'USD',
          2,
          null
        );

        const quoteId = crypto.randomUUID();
        paymentIntent.addLocalQuote({
          id: quoteId,
          exchangeRate: test.exchangeRate,
          debitAmount: test.debitAmount,
          senderWalletAddress: {
            id: crypto.randomUUID(),
            address: 'sender',
            assetCode: 'USD',
            assetScale: 2
          }
        });

        assert.equal(paymentIntent.quotes.length, 1);
        const quote = paymentIntent.quotes[0];
        assert.equal(quote.id, quoteId);
        assert.equal(quote.state, 'COMPLETED');
        assert.equal(quote.receiveAmount, test.expectedReceiveAmount);
        assert.equal(quote.debitAmount, test.debitAmount);
      });
    });

    [
      {
        receiveAmount: 1n,
        expectedDebitAmount: 1n,
        exchangeRate: 1,
        description: 'exchange rate = 1'
      },
      {
        receiveAmount: 10n,
        expectedDebitAmount: 7n,
        exchangeRate: 1.45,
        description: 'exchange rate > 1'
      },
      {
        receiveAmount: 10n,
        expectedDebitAmount: 15n,
        exchangeRate: 0.67,
        description: 'exchange rate < 1 (ceil)'
      }
    ].forEach((test) => {
      it(`successfully creates quote with with receiveAmount and ${test.description}`, () => {
        const paymentIntent = PaymentIntent.create(
          crypto.randomUUID(),
          crypto.randomUUID(),
          'receiver',
          PaymentIntentDestination.LOCAL,
          'USD',
          2,
          null
        );

        const quoteId = crypto.randomUUID();
        paymentIntent.addLocalQuote({
          id: quoteId,
          exchangeRate: test.exchangeRate,
          receiveAmount: test.receiveAmount,
          senderWalletAddress: {
            id: crypto.randomUUID(),
            address: 'sender',
            assetCode: 'USD',
            assetScale: 2
          }
        });

        assert.equal(paymentIntent.quotes.length, 1);
        const quote = paymentIntent.quotes[0];
        assert.equal(quote.id, quoteId);
        assert.equal(quote.state, 'COMPLETED');
        assert.equal(quote.debitAmount, test.expectedDebitAmount);
        assert.equal(quote.receiveAmount, test.receiveAmount);
      });
    });

    [
      {
        receiveAmount: 1n,
        expectedDebitAmount: 1n,
        exchangeRate: 1,
        description: 'exchange rate = 1'
      },
      {
        receiveAmount: 10n,
        expectedDebitAmount: 7n,
        exchangeRate: 1.45,
        description: 'exchange rate > 1'
      },
      {
        receiveAmount: 10n,
        expectedDebitAmount: 15n,
        exchangeRate: 0.67,
        description: 'exchange rate < 1 (ceil)'
      }
    ].forEach((test) => {
      it(`successfully creates quote with with receiveAmount and ${test.description}`, () => {
        const paymentIntent = PaymentIntent.create(
          crypto.randomUUID(),
          crypto.randomUUID(),
          'receiver',
          PaymentIntentDestination.LOCAL,
          'USD',
          2,
          null
        );

        const quoteId = crypto.randomUUID();
        paymentIntent.addLocalQuote({
          id: quoteId,
          exchangeRate: test.exchangeRate,
          receiveAmount: test.receiveAmount,
          senderWalletAddress: {
            id: crypto.randomUUID(),
            address: 'sender',
            assetCode: 'USD',
            assetScale: 2
          }
        });

        assert.equal(paymentIntent.quotes.length, 1);
        const quote = paymentIntent.quotes[0];
        assert.equal(quote.state, 'COMPLETED');
        assert.equal(quote.id, quoteId);
        assert.equal(quote.debitAmount, test.expectedDebitAmount);
        assert.equal(quote.receiveAmount, test.receiveAmount);
      });
    });
  });

  describe('addLocalPayment', () => {
    it('adds a payment using quoteId', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );

      const quoteId = crypto.randomUUID();
      const senderWalletAddressId = crypto.randomUUID();
      paymentIntent.addLocalQuote({
        id: quoteId,
        debitAmount: 200n,
        exchangeRate: 0.5,
        senderWalletAddress: {
          id: senderWalletAddressId,
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      const paymentId = crypto.randomUUID();
      paymentIntent.addLocalPayment({
        id: paymentId,
        quoteId,
        exchangeRate: 1, // won't be used since quoteId is provided
        senderWalletAddress: {
          id: senderWalletAddressId,
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      assert.equal(paymentIntent.payments.length, 1);
      const payment = paymentIntent.payments[0];
      assert.equal(payment.id, paymentId);
      assert.equal(payment.quoteId, quoteId);
      assert.equal(payment.debitAmount, 200n);
      assert.equal(payment.receiveAmount, 100n);
    });

    it('adds a payment using debitAmount', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );

      const paymentId = crypto.randomUUID();
      paymentIntent.addLocalPayment({
        id: paymentId,
        debitAmount: 200n,
        exchangeRate: 0.5,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      assert.equal(paymentIntent.payments.length, 1);
      const payment = paymentIntent.payments[0];
      assert.equal(payment.id, paymentId);
      assert.equal(payment.debitAmount, 200n);
      assert.equal(payment.receiveAmount, 100n);
    });

    it('successfully adds payment with incomingAmount from payment intent', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null,
        100n
      );

      const paymentId = crypto.randomUUID();
      paymentIntent.addLocalPayment({
        id: paymentId,
        exchangeRate: 0.5,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      assert.equal(paymentIntent.payments.length, 1);
      const payment = paymentIntent.payments[0];
      assert.equal(payment.id, paymentId);
      assert.equal(payment.debitAmount, 200n);
      assert.equal(payment.receiveAmount, 100n);
    });

    it('throws InvalidQuoteIdError on duplicate payment id', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );

      const paymentArgs = {
        id: crypto.randomUUID(),
        debitAmount: 200n,
        exchangeRate: 0.5,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      };

      paymentIntent.addLocalPayment(paymentArgs);

      assert.throws(
        () => {
          paymentIntent.addLocalPayment(paymentArgs);
        },
        (err: Error) => {
          assert(err instanceof InvalidPaymentIdError);
          assert.match(err.message, /Duplicate payment id/);
          return true;
        }
      );
    });

    it('throws InvalidQuoteIdError if quoteId is not found', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );

      assert.throws(
        () => {
          paymentIntent.addLocalPayment({
            id: crypto.randomUUID(),
            quoteId: crypto.randomUUID(),
            exchangeRate: 1,
            senderWalletAddress: {
              id: crypto.randomUUID(),
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            }
          });
        },
        (err: Error) => {
          assert(err instanceof InvalidQuoteIdError);
          assert.match(err.message, /Could not find/);
          return true;
        }
      );
    });

    it('throws InvalidQuoteStateError if quote is already consumed by a COMPLETED payment', () => {
      const senderWalletAddressId = crypto.randomUUID();
      const quoteId = crypto.randomUUID();
      const paymentIntentId = crypto.randomUUID();
      const paymentIntent = PaymentIntent.fromObject({
        id: paymentIntentId,
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
        quotes: [
          {
            id: quoteId,
            state: 'COMPLETED',
            senderWalletAddress: 'sender',
            senderWalletAddressId,
            receiveAmount: 100n,
            debitAmount: 200n,
            exchangeRate: 0.5,
            expiresAt: new Date(Date.now() + 1000 * 60)
          }
        ],
        payments: [
          {
            id: crypto.randomUUID(),
            state: 'COMPLETED',
            quoteId,
            senderWalletAddress: 'sender',
            paymentIntentId,
            senderWalletAddressId,
            assetCode: 'USD',
            assetScale: 2,
            createdAt: new Date(),
            debitAmount: 200n,
            receiveAmount: 100n,
            sentAmount: 0n
          }
        ]
      });

      const newPaymentId = crypto.randomUUID();

      assert.throws(
        () => {
          paymentIntent.addLocalPayment({
            id: newPaymentId,
            quoteId,
            exchangeRate: 1,
            senderWalletAddress: {
              id: senderWalletAddressId,
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            }
          });
        },
        (err: Error) => {
          assert(err instanceof InvalidQuoteStateError, 'help');
          assert.match(err.message, /Already consumed quote/, '2');
          return true;
        }
      );
    });

    it('throws InvalidQuoteStateError if quote is not COMPLETED', () => {
      const senderWalletAddressId = crypto.randomUUID();
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
        quotes: [
          {
            id: 'pending-quote',
            state: 'PENDING',
            senderWalletAddress: 'sender',
            senderWalletAddressId
          }
        ],
        payments: []
      });

      assert.throws(
        () => {
          paymentIntent.addLocalPayment({
            id: crypto.randomUUID(),
            quoteId: 'pending-quote',
            exchangeRate: 1,
            senderWalletAddress: {
              id: senderWalletAddressId,
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            }
          });
        },
        (err: Error) => {
          assert(err instanceof InvalidQuoteStateError);
          assert.match(err.message, /not completed/);
          return true;
        }
      );
    });

    it('throws QuoteExpiredError if quote is expired', () => {
      const senderWalletAddressId = crypto.randomUUID();
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
        quotes: [
          {
            id: 'expired-quote',
            state: 'COMPLETED',
            debitAmount: 200n,
            receiveAmount: 100n,
            exchangeRate: 0.5,
            expiresAt: new Date(Date.now() - 1000),
            senderWalletAddress: 'sender',
            senderWalletAddressId
          }
        ],
        payments: []
      });

      assert.throws(
        () => {
          paymentIntent.addLocalPayment({
            id: crypto.randomUUID(),
            quoteId: 'expired-quote',
            exchangeRate: 1,
            senderWalletAddress: {
              id: senderWalletAddressId,
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            }
          });
        },
        (err: Error) => {
          assert(err instanceof QuoteExpiredError);
          assert.match(err.message, /Quote expired/);
          return true;
        }
      );
    });

    it('fails if payment intent is in invalid state', () => {
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'COMPLETED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
        quotes: [],
        payments: []
      });

      assert.throws(
        () => {
          paymentIntent.addLocalPayment({
            id: crypto.randomUUID(),
            debitAmount: 200n,
            exchangeRate: 0.5,
            senderWalletAddress: {
              id: crypto.randomUUID(),
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            }
          });
        },
        (err: Error) => {
          assert(err instanceof PaymentIntentInvalidState);
          assert.match(err.message, /invalid state/);
          return true;
        }
      );
    });

    it('fails if payment intent is expired', () => {
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
        quotes: [],
        payments: []
      });

      assert.throws(
        () => {
          paymentIntent.addLocalPayment({
            id: crypto.randomUUID(),
            debitAmount: 200n,
            exchangeRate: 0.5,
            senderWalletAddress: {
              id: crypto.randomUUID(),
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            }
          });
        },
        (err: Error) => {
          assert(err instanceof PaymentIntentExpired);
          assert.match(err.message, /expired/);
          return true;
        }
      );
    });

    it('fails if quote wallet address does not match sender wallet address', () => {
      const quoteId = crypto.randomUUID();
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        quotes: [
          {
            id: quoteId,
            state: 'COMPLETED',
            debitAmount: 200n,
            receiveAmount: 100n,
            exchangeRate: 0.5,
            expiresAt: new Date(Date.now() + 1000),
            senderWalletAddress: 'sender',
            senderWalletAddressId: crypto.randomUUID()
          }
        ],
        payments: []
      });

      assert.throws(
        () => {
          paymentIntent.addLocalPayment({
            id: crypto.randomUUID(),
            debitAmount: 200n,
            exchangeRate: 0.5,
            quoteId,
            senderWalletAddress: {
              id: crypto.randomUUID(),
              address: 'other-sender',
              assetCode: 'USD',
              assetScale: 2
            }
          });
        },
        (err: Error) => {
          assert(err instanceof InvalidQuoteStateError);
          assert.match(err.message, /Invalid sender/);
          return true;
        }
      );
    });

    it('fails if no amounts provided for payment', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );

      assert.throws(
        () => {
          paymentIntent.addLocalPayment({
            id: crypto.randomUUID(),
            exchangeRate: 0.5,
            senderWalletAddress: {
              id: crypto.randomUUID(),
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            }
          });
        },
        (err: Error) => {
          assert(err instanceof InvalidPaymentAmountError);
          return true;
        }
      );
    });

    [
      {
        debitAmount: 1n,
        expectedReceiveAmount: 1n,
        exchangeRate: 1,
        description: 'exchange rate = 1'
      },
      {
        debitAmount: 10n,
        expectedReceiveAmount: 14n,
        exchangeRate: 1.4,
        description: 'exchange rate > 1'
      },
      {
        debitAmount: 10n,
        expectedReceiveAmount: 6n,
        exchangeRate: 0.67,
        description: 'exchange rate < 1 (flooring)'
      }
    ].forEach((test) => {
      it(`successfully creates payment with debitAmount and ${test.description}`, () => {
        const paymentIntent = PaymentIntent.create(
          crypto.randomUUID(),
          crypto.randomUUID(),
          'receiver',
          PaymentIntentDestination.LOCAL,
          'USD',
          2,
          null
        );

        const paymentId = crypto.randomUUID();
        paymentIntent.addLocalPayment({
          id: paymentId,
          exchangeRate: test.exchangeRate,
          debitAmount: test.debitAmount,
          senderWalletAddress: {
            id: crypto.randomUUID(),
            address: 'sender',
            assetCode: 'USD',
            assetScale: 2
          }
        });

        assert.equal(paymentIntent.payments.length, 1);
        const payment = paymentIntent.payments[0];
        assert.equal(payment.id, paymentId);
        assert.equal(payment.receiveAmount, test.expectedReceiveAmount);
        assert.equal(payment.debitAmount, test.debitAmount);
      });
    });
  });

  describe('completeLocalPayment', () => {
    it('completes a payment successfully', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );

      const paymentId = crypto.randomUUID();
      paymentIntent.addLocalPayment({
        id: paymentId,
        exchangeRate: 1,
        debitAmount: 100n,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      paymentIntent.completeLocalPayment({ id: paymentId });

      const payment = paymentIntent.payments[0];
      assert.equal(payment.state, 'COMPLETED');
      assert.equal(payment.sentAmount, 100n);
      assert.equal(paymentIntent.receivedAmount, 100n);
      assert.equal(paymentIntent.state, 'CREATED');
    });

    it('completes a payment successfully and marks payment intent as completed', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null,
        100n
      );

      const paymentId = crypto.randomUUID();
      paymentIntent.addLocalPayment({
        id: paymentId,
        exchangeRate: 1,
        debitAmount: 100n,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      paymentIntent.completeLocalPayment({ id: paymentId });

      const payment = paymentIntent.payments[0];
      assert.equal(payment.state, 'COMPLETED');
      assert.equal(payment.sentAmount, 100n);
      assert.equal(paymentIntent.receivedAmount, 100n);
      assert.equal(paymentIntent.state, 'COMPLETED');
    });

    it('completes a payment successfully overpaying more than incomingAmount', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null,
        100n
      );

      const paymentId = crypto.randomUUID();
      paymentIntent.addLocalPayment({
        id: paymentId,
        exchangeRate: 1,
        debitAmount: 110n,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      paymentIntent.completeLocalPayment({ id: paymentId });

      const payment = paymentIntent.payments[0];
      assert.equal(payment.state, 'COMPLETED');
      assert.equal(payment.sentAmount, 110n);
      assert.equal(paymentIntent.incomingAmount, 100n);
      assert.equal(paymentIntent.receivedAmount, 110n);
      assert(paymentIntent.receivedAmount >= paymentIntent.incomingAmount);
      assert.equal(paymentIntent.state, 'COMPLETED');
    });

    it('fails if payment intent is in invalid state', () => {
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'COMPLETED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
        quotes: [],
        payments: []
      });

      assert.throws(
        () => {
          paymentIntent.completeLocalPayment({ id: crypto.randomUUID() });
        },
        (err: Error) => {
          assert(err instanceof PaymentIntentInvalidState);
          assert.match(err.message, /invalid state/);
          return true;
        }
      );
    });

    it('fails if payment intent is expired', () => {
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
        quotes: [],
        payments: []
      });

      assert.throws(
        () => {
          paymentIntent.completeLocalPayment({ id: crypto.randomUUID() });
        },
        (err: Error) => {
          assert(err instanceof PaymentIntentExpired);
          assert.match(err.message, /expired/);
          return true;
        }
      );
    });

    it('fails if payment not found', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );

      assert.throws(
        () => {
          paymentIntent.completeLocalPayment({ id: crypto.randomUUID() });
        },
        (err: Error) => {
          assert(err instanceof PaymentNotFoundError);
          assert.match(err.message, /not found/);
          return true;
        }
      );
    });

    it('fails if payment is already completed', () => {
      const paymentIntentId = crypto.randomUUID();
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
        quotes: [],
        payments: [
          {
            id: 'payment-1',
            state: 'COMPLETED',
            paymentIntentId: paymentIntentId,
            senderWalletAddress: 'sender',
            senderWalletAddressId: crypto.randomUUID(),
            assetCode: 'USD',
            assetScale: 2,
            createdAt: new Date(),
            debitAmount: 100n,
            receiveAmount: 100n,
            sentAmount: 100n
          }
        ]
      });

      assert.throws(
        () => {
          paymentIntent.completeLocalPayment({ id: 'payment-1' });
        },
        (err: Error) => {
          assert(err instanceof PaymentInvalidStateError);
          assert.match(err.message, /already completed/);
          return true;
        }
      );
    });
  });

  describe('cancelPayment', () => {
    it('cancels a created payment successfully', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );

      const paymentId = crypto.randomUUID();
      const beforeCancel = Date.now();
      paymentIntent.addLocalPayment({
        id: paymentId,
        exchangeRate: 1,
        debitAmount: 100n,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        }
      });

      paymentIntent.cancelPayment({ id: paymentId, reason: 'user requested' });
      const afterCancel = Date.now();

      const payment = paymentIntent.payments[0];
      assert.equal(payment.state, 'CANCELLED');
      assert.equal(payment.cancelReason, 'user requested');
      assert.ok(payment.cancelledAt);
      assert.ok(payment.cancelledAt.getTime() >= beforeCancel);
      assert.ok(payment.cancelledAt.getTime() <= afterCancel);
      assert.equal(payment.sentAmount, 0n);
      assert.equal(paymentIntent.receivedAmount, 0n);
      assert.equal(paymentIntent.state, 'CREATED');
    });

    it('fails if payment not found', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.LOCAL,
        'USD',
        2,
        null
      );

      assert.throws(
        () => {
          paymentIntent.cancelPayment({
            id: crypto.randomUUID(),
            reason: 'user requested'
          });
        },
        (err: Error) => {
          assert(err instanceof PaymentNotFoundError);
          assert.match(err.message, /not found/);
          return true;
        }
      );
    });

    it('fails if payment is already cancelled', () => {
      const paymentIntentId = crypto.randomUUID();
      const paymentIntent = PaymentIntent.fromObject({
        id: paymentIntentId,
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
        quotes: [],
        payments: [
          {
            id: 'payment-1',
            state: 'CANCELLED',
            paymentIntentId: paymentIntentId,
            senderWalletAddress: 'sender',
            senderWalletAddressId: crypto.randomUUID(),
            assetCode: 'USD',
            assetScale: 2,
            createdAt: new Date(),
            debitAmount: 100n,
            receiveAmount: 100n,
            sentAmount: 0n
          }
        ]
      });

      assert.throws(
        () => {
          paymentIntent.cancelPayment({
            id: 'payment-1',
            reason: 'user requested'
          });
        },
        (err: Error) => {
          assert(err instanceof PaymentInvalidStateError);
          assert.match(err.message, /already cancelled/);
          return true;
        }
      );
    });

    it('fails if payment is already completed', () => {
      const paymentIntentId = crypto.randomUUID();
      const paymentIntent = PaymentIntent.fromObject({
        id: paymentIntentId,
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.LOCAL,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
        quotes: [],
        payments: [
          {
            id: 'payment-1',
            state: 'COMPLETED',
            paymentIntentId: paymentIntentId,
            senderWalletAddress: 'sender',
            senderWalletAddressId: crypto.randomUUID(),
            assetCode: 'USD',
            assetScale: 2,
            createdAt: new Date(),
            debitAmount: 100n,
            receiveAmount: 100n,
            sentAmount: 100n
          }
        ]
      });

      assert.throws(
        () => {
          paymentIntent.cancelPayment({
            id: 'payment-1',
            reason: 'user requested'
          });
        },
        (err: Error) => {
          assert(err instanceof PaymentInvalidStateError);
          assert.match(err.message, /already complete/);
          return true;
        }
      );
    });
  });

  describe('addPendingRemoteQuote', () => {
    it('adds a quote in PENDING state', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.REMOTE,
        'USD',
        2,
        null
      );

      const quoteId = crypto.randomUUID();
      const senderWalletAddressId = crypto.randomUUID();

      paymentIntent.addPendingRemoteQuote({
        id: quoteId,
        senderWalletAddress: {
          id: senderWalletAddressId,
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        },
        peerId: 'sender-peer',
        peerAssetCode: 'USD',
        peerAssetScale: 2,
        sourceAmount: 100n,
        receiveAmount: 100n
      });

      assert.equal(paymentIntent.quotes.length, 1);
      const quote = paymentIntent.quotes[0];
      assert.equal(quote.id, quoteId);
      assert.equal(quote.state, 'PENDING');
      assert.equal(quote.senderWalletAddress, 'sender');
      assert.equal(quote.senderWalletAddressId, senderWalletAddressId);
      assert.equal(quote.receiveAmount, 100n);
    });

    it('throws InvalidQuoteIdError on duplicate quote id', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.REMOTE,
        'USD',
        2,
        null
      );

      const args = {
        id: crypto.randomUUID(),
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        },
        peerId: 'sender-peer',
        peerAssetCode: 'USD',
        peerAssetScale: 2,
        sourceAmount: 100n,
        receiveAmount: 100n
      };

      paymentIntent.addPendingRemoteQuote(args);

      assert.throws(
        () => paymentIntent.addPendingRemoteQuote(args),
        (err: Error) => {
          assert(err instanceof InvalidQuoteIdError);
          assert.match(err.message, /Duplicate quote id/);
          return true;
        }
      );
    });

    it('throws PaymentIntentInvalidState if payment intent is not CREATED', () => {
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.REMOTE,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'COMPLETED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
        quotes: [],
        payments: []
      });

      assert.throws(
        () =>
          paymentIntent.addPendingRemoteQuote({
            id: crypto.randomUUID(),
            senderWalletAddress: {
              id: crypto.randomUUID(),
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            },
            peerId: 'sender-peer',
            peerAssetCode: 'USD',
            peerAssetScale: 2,
            sourceAmount: 100n
          }),
        (err: Error) => {
          assert(err instanceof PaymentIntentInvalidState);
          return true;
        }
      );
    });

    it('throws PaymentIntentExpired if payment intent is expired', () => {
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.REMOTE,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
        quotes: [],
        payments: []
      });

      assert.throws(
        () =>
          paymentIntent.addPendingRemoteQuote({
            id: crypto.randomUUID(),
            senderWalletAddress: {
              id: crypto.randomUUID(),
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            },
            peerId: 'sender-peer',
            peerAssetCode: 'USD',
            peerAssetScale: 2,
            sourceAmount: 100n
          }),
        (err: Error) => {
          assert(err instanceof PaymentIntentExpired);
          return true;
        }
      );
    });

    it('throws InvalidQuoteAmountError if neither debitAmount nor receiveAmount is provided', () => {
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.REMOTE,
        'USD',
        2,
        null
      );

      assert.throws(
        () =>
          paymentIntent.addPendingRemoteQuote({
            id: crypto.randomUUID(),
            senderWalletAddress: {
              id: crypto.randomUUID(),
              address: 'sender',
              assetCode: 'USD',
              assetScale: 2
            },
            peerId: 'sender-peer',
            peerAssetCode: 'USD',
            peerAssetScale: 2,
            sourceAmount: 100n
          }),
        (err: Error) => {
          assert(err instanceof InvalidQuoteAmountError);
          return true;
        }
      );
    });
  });

  describe('completeRemoteQuote', () => {
    const makePaymentIntentWithPendingQuote = (
      expiresAt?: Date,
      overrides: Partial<{
        peerAssetCode: string;
        peerAssetScale: number;
        senderAssetCode: string;
        senderAssetScale: number;
        sourceAmount: bigint;
        debitAmount: bigint;
        receiveAmount: bigint;
        assetCode: string;
        assetScale: number;
      }> = {}
    ) => {
      const quoteId = crypto.randomUUID();
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.REMOTE,
        overrides.assetCode ?? 'USD',
        overrides.assetScale ?? 2,
        expiresAt?.toISOString() ?? null
      );
      paymentIntent.addPendingRemoteQuote({
        id: quoteId,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: overrides.senderAssetCode ?? 'USD',
          assetScale: overrides.senderAssetScale ?? 2
        },
        peerId: 'peer-1',
        peerAssetCode: overrides.peerAssetCode ?? 'USD',
        peerAssetScale: overrides.peerAssetScale ?? 2,
        sourceAmount: overrides.sourceAmount ?? 100n,
        debitAmount: overrides.debitAmount,
        receiveAmount: overrides.receiveAmount ?? 100n
      });
      return { paymentIntent, quoteId };
    };

    it('transitions quote to COMPLETED with correct fields', (context) => {
      const now = Date.now();
      context.mock.timers.enable({ apis: ['Date'], now });

      // same-asset receive: requestedReceive=100, sourceAmount=100,
      // receiveAmountValue=50 -> peerToReceiverRate=0.5
      // computedReceive=100, computedDebit=ceil(100/0.5)=200, exchangeRate=0.5
      const { paymentIntent, quoteId } = makePaymentIntentWithPendingQuote();

      paymentIntent.completeRemoteQuote({
        id: quoteId,
        receiveAmountValue: 50n
      });

      const quote = paymentIntent.quotes[0];
      assert.equal(quote.state, 'COMPLETED');
      assert.equal(quote.debitAmount, 200n);
      assert.equal(quote.receiveAmount, 100n);
      assert.equal(quote.exchangeRate, 0.5);
      assert.equal(
        quote.expiresAt.getTime(),
        new Date(now + 1000 * 60 * 10).getTime()
      );
    });

    it('caps quote expiry at payment intent expiry if intent expires sooner', () => {
      const intentExpiry = new Date(Date.now() + 1000 * 60); // 1 min
      const { paymentIntent, quoteId } =
        makePaymentIntentWithPendingQuote(intentExpiry);

      paymentIntent.completeRemoteQuote({
        id: quoteId,
        receiveAmountValue: 50n
      });

      assert.equal(paymentIntent.quotes[0].state, 'COMPLETED');
      assert.equal(
        paymentIntent.quotes[0].expiresAt.toISOString(),
        intentExpiry.toISOString()
      );
    });

    it('throws InvalidQuoteIdError if quote not found', () => {
      const { paymentIntent } = makePaymentIntentWithPendingQuote();

      assert.throws(
        () => {
          paymentIntent.completeRemoteQuote({
            id: crypto.randomUUID(),
            receiveAmountValue: 50n
          });
        },
        (err: Error) => {
          assert(err instanceof InvalidQuoteIdError);
          return true;
        }
      );
    });

    it('throws InvalidQuoteStateError if quote is not PENDING', () => {
      const { paymentIntent, quoteId } = makePaymentIntentWithPendingQuote();

      paymentIntent.completeRemoteQuote({
        id: quoteId,
        receiveAmountValue: 50n
      });

      assert.throws(
        () => {
          paymentIntent.completeRemoteQuote({
            id: quoteId,
            receiveAmountValue: 50n
          });
        },
        (err: Error) => {
          assert(err instanceof InvalidQuoteStateError);
          return true;
        }
      );
    });

    it('throws PaymentIntentExpired if payment intent is expired', () => {
      const quoteId = crypto.randomUUID();
      const paymentIntent = PaymentIntent.fromObject({
        id: crypto.randomUUID(),
        receiverWalletAddressId: crypto.randomUUID(),
        receiverWalletAddress: 'receiver',
        destination: PaymentIntentDestination.REMOTE,
        assetCode: 'USD',
        assetScale: 2,
        incomingAmount: null,
        receivedAmount: 0n,
        state: 'CREATED',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
        quotes: [
          {
            id: quoteId,
            state: 'PENDING',
            senderWalletAddress: 'sender',
            senderWalletAddressId: crypto.randomUUID()
          }
        ],
        payments: []
      });

      assert.throws(
        () => {
          paymentIntent.completeRemoteQuote({
            id: quoteId,
            receiveAmountValue: 50n
          });
        },
        (err: Error) => {
          assert(err instanceof PaymentIntentExpired);
          return true;
        }
      );
    });

    describe('FX calculation', () => {
      it('same asset + debitAmount: uses peerToReceiverRate directly', () => {
        const { paymentIntent, quoteId } = makePaymentIntentWithPendingQuote(
          undefined,
          { debitAmount: 500n, receiveAmount: undefined }
        );

        paymentIntent.completeRemoteQuote({
          id: quoteId,
          receiveAmountValue: 10000n
        });

        const quote = paymentIntent.quotes[0];
        assert.equal(quote.state, 'COMPLETED');
        // debitAmount = 500 USD
        // receiveAmount = USD amount * (USD->receiver rate)
        //              = 500 * (10000 / 100)
        //              = 50000
        assert.equal(quote.debitAmount, 500n);
        assert.equal(quote.receiveAmount, 50000n);
        assert.equal(quote.exchangeRate, 100);
      });

      it('same asset + receiveAmount: inverts peerToReceiverRate', () => {
        const { paymentIntent, quoteId } = makePaymentIntentWithPendingQuote(
          undefined,
          { receiveAmount: 1000n }
        );

        paymentIntent.completeRemoteQuote({
          id: quoteId,
          receiveAmountValue: 10000n
        });

        const quote = paymentIntent.quotes[0];
        assert.equal(quote.state, 'COMPLETED');
        // receiveAmount = 1000 USD
        // debitAmount = USD amount * (1 / receiver->USD rate)
        //            = 1000 * (1 / (10000 / 100))
        //            = 10
        assert.equal(quote.debitAmount, 10n);
        assert.equal(quote.receiveAmount, 1000n);
        assert.equal(quote.exchangeRate, 100);
      });

      it('cross-asset + debitAmount: multiplies debit by fxRate and peerToReceiverRate', () => {
        const { paymentIntent, quoteId } = makePaymentIntentWithPendingQuote(
          undefined,
          {
            assetCode: 'XRP',
            assetScale: 6,
            senderAssetCode: 'USD',
            peerAssetCode: 'EUR',
            debitAmount: 1000n,
            receiveAmount: undefined
          }
        );

        paymentIntent.completeRemoteQuote({
          id: quoteId,
          receiveAmountValue: 10000n,
          fxRate: 0.9
        });

        const quote = paymentIntent.quotes[0];
        assert.equal(quote.state, 'COMPLETED');
        // debitAmount = 1000 USD
        // receiveAmount = USD amount * (USD->EUR rate) * (EUR->receiver rate)
        //              = 1000 * (0.9) * (10000 / 100)
        //              = 90000 XRP
        assert.equal(quote.debitAmount, 1000n);
        assert.equal(quote.receiveAmount, 90000n);
        assert.equal(quote.exchangeRate, 90);
      });

      it('cross-asset + receiveAmount: divides receive by peerToReceiverRate and multiplies by fxRate', () => {
        const { paymentIntent, quoteId } = makePaymentIntentWithPendingQuote(
          undefined,
          {
            assetCode: 'XRP',
            assetScale: 6,
            senderAssetCode: 'USD',
            peerAssetCode: 'EUR',
            receiveAmount: 1000n
          }
        );

        paymentIntent.completeRemoteQuote({
          id: quoteId,
          receiveAmountValue: 10000n,
          fxRate: 1.1
        });

        const quote = paymentIntent.quotes[0];
        assert.equal(quote.state, 'COMPLETED');
        // receiveAmount = 1000 XRP
        // debitAmount = XRP amount * (1 / XRP->EUR rate) * (EUR->USD rate)
        //            = 1000 * (1 / (10000 / 100)) * (1.1)
        //            = 11 USD
        assert.equal(quote.debitAmount, 11n);
        assert.equal(quote.receiveAmount, 1000n);
        assert.equal(quote.exchangeRate, 1000 / 11);
      });

      it('throws MissingFxRateError when cross-asset and no fxRate provided', () => {
        const { paymentIntent, quoteId } = makePaymentIntentWithPendingQuote(
          undefined,
          {
            assetCode: 'XRP',
            assetScale: 6,
            senderAssetCode: 'USD',
            peerAssetCode: 'EUR',
            debitAmount: 1000n,
            receiveAmount: undefined
          }
        );

        assert.throws(
          () => {
            paymentIntent.completeRemoteQuote({
              id: quoteId,
              receiveAmountValue: 10000n
            });
          },
          (err: Error) => {
            assert(err instanceof MissingFxRateError);
            return true;
          }
        );
      });
    });
  });

  describe('failRemoteQuote', () => {
    const makePaymentIntentWithPendingQuote = () => {
      const quoteId = crypto.randomUUID();
      const paymentIntent = PaymentIntent.create(
        crypto.randomUUID(),
        crypto.randomUUID(),
        'receiver',
        PaymentIntentDestination.REMOTE,
        'USD',
        2,
        null
      );
      paymentIntent.addPendingRemoteQuote({
        id: quoteId,
        senderWalletAddress: {
          id: crypto.randomUUID(),
          address: 'sender',
          assetCode: 'USD',
          assetScale: 2
        },
        peerId: 'sender-peer',
        peerAssetCode: 'USD',
        peerAssetScale: 2,
        sourceAmount: 100n,
        receiveAmount: 100n
      });
      return { paymentIntent, quoteId };
    };

    it('transitions quote to FAILED with correct fields', () => {
      const { paymentIntent, quoteId } = makePaymentIntentWithPendingQuote();

      paymentIntent.failRemoteQuote({
        id: quoteId,
        errorName: 'QuoteError',
        message: 'rate lookup failed'
      });

      const quote = paymentIntent.quotes[0];
      assert.equal(quote.state, 'FAILED');
      assert.equal(quote.errorName, 'QuoteError');
      assert.equal(quote.message, 'rate lookup failed');
    });

    it('throws InvalidQuoteIdError if quote not found', () => {
      const { paymentIntent } = makePaymentIntentWithPendingQuote();

      assert.throws(
        () => {
          paymentIntent.failRemoteQuote({
            id: crypto.randomUUID(),
            errorName: 'QuoteError',
            message: 'rate lookup failed'
          });
        },
        (err: Error) => {
          assert(err instanceof InvalidQuoteIdError);
          return true;
        }
      );
    });

    it('throws InvalidQuoteStateError if quote is not PENDING', () => {
      const { paymentIntent, quoteId } = makePaymentIntentWithPendingQuote();

      paymentIntent.failRemoteQuote({
        id: quoteId,
        errorName: 'QuoteError',
        message: 'rate lookup failed'
      });

      assert.throws(
        () => {
          paymentIntent.failRemoteQuote({
            id: quoteId,
            errorName: 'QuoteError',
            message: 'rate lookup failed'
          });
        },
        (err: Error) => {
          assert(err instanceof InvalidQuoteStateError);
          return true;
        }
      );
    });
  });
});
