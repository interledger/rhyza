/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  ILogger,
  ITelemetryCounter,
  ITelemetryGauge,
  ITelemetryHistogram,
  ITelemetryService,
  ITelemetryServiceAttributes
} from 'common-types-lib';
import process from 'process';
import { NodeTracerProvider } from '@opentelemetry/node';

import { Resource, resourceFromAttributes } from '@opentelemetry/resources';

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import {
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION
} from '@opentelemetry/semantic-conventions/incubating';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import {
  Attributes,
  Counter,
  Gauge,
  Histogram,
  MetricOptions,
  Tracer,
  metrics
} from '@opentelemetry/api';

const OPEN_TELEMETRY_COLLECTOR_URL =
  process.env['OPEN_TELEMETRY_COLLECTOR_URL'] || 'http://127.0.0.1:4317';

const OPEN_TELEMETRY_EXPORT_INTERVAL_MS = process.env[
  'OPEN_TELEMETRY_EXPORT_INTERVAL_MS'
]
  ? parseInt(process.env['OPEN_TELEMETRY_EXPORT_INTERVAL_MS'])
  : 15_000;

export class OpenTelemetryService implements ITelemetryService {
  private _logger: ILogger;
  private _bcName: string;
  private _appName: string;
  private _appVersion: string;
  private _instanceId: string;
  private _counters: Map<string, Counter>;

  private _histograms: Map<string, Histogram>;
  private _gauges: Map<string, Gauge>;
  //private _tracers: Map<string, Tracer>;

  fastifyOtelInstrumentation?: FastifyOtelInstrumentation;
  // private _provider: NodeTracerProvider;

  private static instance: OpenTelemetryService;

  private constructor(
    bcName: string,
    appName: string,
    appVersion: string,
    instanceId: string,
    logger: ILogger,
    collectorUrl?: string
  ) {
    this._bcName = bcName;
    this._appName = appName;
    this._appVersion = appVersion;
    this._instanceId = instanceId;
    this._logger = logger.child(this.constructor.name);
    this._counters = new Map();
    this._histograms = new Map();
    this._gauges = new Map();
    //this._tracers = new Map();
  }

  static getInstance(): ITelemetryService {
    if (this.instance) return this.instance;

    throw new Error(
      'Called OpenTelemetryServiceClient.getInstance() before OpenTelemetryClient.Start()'
    );
  }

  static Start(
    bcName: string,
    appName: string,
    appVersion: string,
    instanceId: string,
    logger: ILogger,
    collectorUrl?: string
  ) {
    if (this.instance) {
      throw new Error(
        'Called OpenTelemetryClient.start() a second time - already started'
      );
    }

    if (!collectorUrl) {
      collectorUrl = OPEN_TELEMETRY_COLLECTOR_URL;
    }

    const commonResource: Resource = resourceFromAttributes({
      [ATTR_SERVICE_NAMESPACE]: bcName,
      [ATTR_SERVICE_NAME]: appName,
      [ATTR_SERVICE_VERSION]: appVersion,
      [ATTR_SERVICE_INSTANCE_ID]: instanceId
    });

    this.instance = new OpenTelemetryService(
      bcName,
      appName,
      appVersion,
      instanceId,
      logger
    );

    const metricExporterReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: collectorUrl
      }),
      exportIntervalMillis: OPEN_TELEMETRY_EXPORT_INTERVAL_MS
    });

    const traceExporter = new OTLPTraceExporter({
      url: collectorUrl
    });

    const sdk = new NodeSDK({
      resource: commonResource,
      traceExporter: traceExporter,
      metricReader: metricExporterReader
    });

    sdk.start();

    this.instance.fastifyOtelInstrumentation = new FastifyOtelInstrumentation({
      // @ts-expect-error TODO fix fastify otel instrumentation
      servername: `${appName}_${instanceId}`
    });

    const tracerProvider = new NodeTracerProvider({
      // TODO: fix lint
      // @ts-expect-error type mismatch between opentelemetry libraries
      resource: commonResource,
      spanProcessors: [new BatchSpanProcessor(traceExporter)]
    });

    this.instance.fastifyOtelInstrumentation.setTracerProvider(tracerProvider);

    tracerProvider.register();

    registerInstrumentations({
      instrumentations: [
        // Fastify instrumentation expects HTTP instrumentation
        new HttpInstrumentation(),
        new PgInstrumentation()
      ]
    });

    this.instance._logger.info(
      `OpenTelemetryClient Started with - collector url: "${collectorUrl}"`
    );
  }

  private _getOrCreateCounter(name: string, options?: MetricOptions): Counter {
    if (!this._counters.has(name)) {
      this._counters.set(
        name,
        metrics.getMeter(this._appName).createCounter(name, options)
      );
    }
    return this._counters.get(name)!;
  }

  private _getOrCreateHistogram(
    name: string,
    options?: MetricOptions
  ): Histogram {
    if (!this._histograms.has(name)) {
      this._histograms.set(
        name,
        metrics.getMeter(this._appName).createHistogram(name, options)
      );
    }
    return this._histograms.get(name)!;
  }

  public incrementCounter(
    name: string,
    amount: number,
    attributes: Attributes = {}
  ): void {
    this._getOrCreateCounter(name).add(amount, attributes);
  }

  private _getOrCreateGauge(name: string, options?: MetricOptions): Gauge {
    let gauge = this._gauges.get(name);
    if (gauge) return gauge;

    gauge = metrics.getMeter(this._appName).createGauge(name, options);
    this._gauges.set(name, gauge);

    return gauge;
  }

  public updateGauge(
    name: string,
    value: number,
    attributes: Attributes = {}
  ): void {
    this._getOrCreateGauge(name).record(value, attributes);
  }

  public recordHistogram(
    name: string,
    value: number,
    attributes?: Attributes
  ): void {
    this._getOrCreateHistogram(name).record(value, attributes);
  }

  public startTimer(
    name: string,
    attributes: Attributes = {}
  ): (additionalAttributes?: Attributes) => void {
    const start = process.hrtime.bigint();
    return (additionalAttributes: Attributes = {}) => {
      const elapsedNs = Number(process.hrtime.bigint() - start);
      this.recordHistogram(name, elapsedNs, {
        ...attributes,
        ...additionalAttributes
      });
    };
  }

  // Methods to return instances of the metrics to be long-lived
  // with attributes pre-filled on the get

  public getHistogram(
    name: string,
    attributes?: ITelemetryServiceAttributes
  ): ITelemetryHistogram {
    const histo = this._getOrCreateHistogram(name);

    return {
      observe: (
        value: number,
        additionalAttributes?: ITelemetryServiceAttributes
      ) => {
        histo.record(value, { ...attributes, ...additionalAttributes });
      },
      startTimer: (
        attributes?: ITelemetryServiceAttributes
      ): ((additionalAttributes?: ITelemetryServiceAttributes) => void) => {
        const start = process.hrtime.bigint();
        return (additionalAttributes?: ITelemetryServiceAttributes) => {
          const elapsedNs = Number(process.hrtime.bigint() - start);
          this.recordHistogram(name, elapsedNs, {
            ...attributes,
            ...additionalAttributes
          });
        };
      }
    };
  }

  public getGauge(
    name: string,
    attributes?: ITelemetryServiceAttributes
  ): ITelemetryGauge {
    const gauge = this._getOrCreateGauge(name, attributes);
    return {
      set: (
        value: number,
        additionalAttributes?: ITelemetryServiceAttributes
      ) => {
        gauge.record(value, { ...attributes, ...additionalAttributes });
      }
    };
  }

  public getCounter(
    name: string,
    attributes?: ITelemetryServiceAttributes
  ): ITelemetryCounter {
    const counter = this._getOrCreateCounter(name, attributes);
    return {
      dec: (
        amount?: number,
        additionalAttributes?: ITelemetryServiceAttributes
      ) => {
        if (!amount) amount = -1;
        if (amount > 0) amount = amount * -1;
        counter.add(amount, { ...attributes, ...additionalAttributes });
      },
      inc: (
        amount: number,
        additionalAttributes?: ITelemetryServiceAttributes
      ) => {
        if (!amount) amount = 1;
        counter.add(amount, { ...attributes, ...additionalAttributes });
      }
    };
  }

  /*
  // tracing - WIP

  private _getOrCreateTracer(name: string) {
    let tracer = this._tracers.get(name);
    if (tracer) return tracer;

    tracer = trace.getTracer(name);
    this._tracers.set(name, tracer);

    return tracer;
  }

  public startActiveSpan(
    name: string,
    fn: (span: ITelemetrySpan) => void
  ): void {
    const tracer = this._getOrCreateTracer(name);

    tracer.startActiveSpan(name, (span: Span) => {
      const wrapperSpan: ITelemetrySpan = {
        setAttribute: (key: string, value: string) => {
          span.setAttribute(key, value);
        },
        recordException: (error: Error) => {
          span.recordException(error);
        },
        setStatus: (status: { code: number; message: string }) => {
          span.setStatus(status);
        }
      };

      fn(wrapperSpan);

      // automatically call end() when the span is done
      span.end();
    });
  }
  */
}
