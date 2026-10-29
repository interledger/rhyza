function outboundCorrelationTtlMs(expiresAt: string): number {
  const deadline = Date.parse(expiresAt);
  const remaining =
    (Number.isFinite(deadline) ? deadline : Date.now() + 30_000) - Date.now();
  return Math.max(remaining, 1);
}

export { outboundCorrelationTtlMs };
