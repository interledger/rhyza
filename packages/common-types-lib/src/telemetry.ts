export interface ITelemetryServiceAttributes {
  [attributeKey: string]: string | number | boolean | undefined;
}

export interface ITelemetryHistogram {
  observe(value: number): void;
  observe(value: number, attributes?: ITelemetryServiceAttributes): void;
  startTimer(
    attributes?: ITelemetryServiceAttributes
  ): (additionalAttributes?: ITelemetryServiceAttributes) => void;
}

export interface ITelemetryGauge {
  set(value: number, attributes?: ITelemetryServiceAttributes): void;
}

export interface ITelemetryCounter {
  inc(amount?: number, attributes?: ITelemetryServiceAttributes): void;
  dec(amount?: number, attributes?: ITelemetryServiceAttributes): void;
}

export interface ITelemetrySpan {
  setAttribute(key: string, value: string): void;
  recordException(error: Error): void;
  setStatus(status: { code: number; message: string }): void;
}

export interface ITelemetryTracer {
  startActiveSpan(name: string): (span: () => ITelemetrySpan) => void;
}

export interface ITelemetryService {
  incrementCounter(
    name: string,
    amount: number,
    attributes?: ITelemetryServiceAttributes
  ): void;
  startTimer(
    name: string,
    attributes?: ITelemetryServiceAttributes
  ): (additionalAttributes?: ITelemetryServiceAttributes) => void;
  recordHistogram(
    name: string,
    value: number,
    attributes?: ITelemetryServiceAttributes
  ): void;
  updateGauge(
    name: string,
    value: number,
    attributes?: ITelemetryServiceAttributes
  ): void;

  // new methods
  getHistogram(
    name: string,
    attributes?: ITelemetryServiceAttributes
  ): ITelemetryHistogram;
  getGauge(
    name: string,
    attributes?: ITelemetryServiceAttributes
  ): ITelemetryGauge;
  getCounter(
    name: string,
    attributes?: ITelemetryServiceAttributes
  ): ITelemetryCounter;
}

// common property names so we all collect telemetry the same way
export const TELEMETRY_PROPS_CALL_NAME_PROP = 'callName';
export const TELEMETRY_PROPS_SUCCESS_PROP = 'success';
export const TELEMETRY_PROPS_DATA_FORMAT_PROP = 'dataFormat';
