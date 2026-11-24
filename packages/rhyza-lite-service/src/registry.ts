import type {
  IRawMessageSerializerFactory,
  ITelemetryService
} from 'common-types-lib';
// Import every service from dist/service, never the package root: each package's
// main (dist/index.js) calls start() and installs signal handlers on import.
import { AdminApiService } from 'admin-api-service/dist/service';
import { AuthApiService } from 'auth-api-service/dist/service';
import { AuthCommandHandlerService } from 'auth-command-handler-service/dist/service';
import { AuthEventHandlerService } from 'auth-event-handler-service/dist/service';
import { HttpSignatureService } from 'http-signature-service/dist/service';
import { IdpInteractionServer } from 'idp-interaction-service/dist/service';
import { IlpApiService } from 'ilp-api-service/dist/service';
import { IlpCommandHandlerService } from 'ilp-command-handler-service/dist/service';
import { IlpConnectorService } from 'ilp-connector-service/dist/src/service';
import { IlpEventHandlerService } from 'ilp-event-handler-service/dist/service';
import { NotificationsCommandHandlerService } from 'notifications-command-handler-service/dist/service';
import { NotificationsEventHandlerService } from 'notifications-event-handler-service/dist/service';
import { OpenPaymentsAuthServer } from 'open-payments-auth-service/dist/service';
import { OpenPaymentsResourceServer } from 'open-payments-resource-service/dist/service';
import { PalApiService } from 'pal-api-service/dist/service';
import { PalLedgerEventHandlerService } from 'pal-event-handler-service/dist/service';
import { PalLedgerCommandHandlerService } from 'pal-ledger-command-handler-service/dist/service';
import { PaymentsApiService } from 'payments-api-service/dist/service';
import { PaymentsCommandHandlerService } from 'payments-command-handler-service/dist/service';
import { PaymentsEventHandlerService } from 'payments-event-handler-service/dist/service';
import type { LiteServiceEntry } from './runner';
import { SERVICE_START_ORDER } from './service-names';

/** Process-wide objects created once by the runner and handed to the PAL services. */
export interface SharedDeps {
  readonly serializationFactory: IRawMessageSerializerFactory;
  readonly telemetry: ITelemetryService;
}

type Lifecycle = Omit<LiteServiceEntry, 'name'>;

/** One entry per name in SERVICE_START_ORDER, same order. */
export function buildServiceEntries(deps: SharedDeps): LiteServiceEntry[] {
  const factory = deps.serializationFactory;
  const telemetry = deps.telemetry;
  // PAL services get `undefined` for the logger so each builds its own PinoLogger
  // with its own BC and app names. Passing the factory skips their serde
  // registration; passing telemetry skips OpenTelemetryService.Start().
  const lifecycles: Record<string, Lifecycle> = {
    'pal-api-service': {
      start: () =>
        PalApiService.start(
          undefined, // logger
          factory,
          undefined, // kafkaBuilder
          undefined, // assetRepo
          undefined, // walletRepo
          undefined, // peerRepo
          undefined, // fxRepo
          undefined, // aseFxService
          undefined, // ledgerReadSideRepo
          telemetry
        ),
      stop: () => PalApiService.stop()
    },
    'payments-api-service': {
      start: () => PaymentsApiService.start(),
      stop: () => PaymentsApiService.stop()
    },
    'ilp-api-service': {
      start: () => IlpApiService.start(),
      stop: () => IlpApiService.stop()
    },
    'auth-api-service': {
      start: () => AuthApiService.start(),
      stop: () => AuthApiService.stop()
    },
    'pal-ledger-command-handler-service': {
      start: () =>
        PalLedgerCommandHandlerService.start(
          undefined, // logger
          factory,
          undefined, // kafkaBuilder
          undefined, // esRepo
          undefined, // producer
          undefined, // consumer
          telemetry
        ),
      stop: () => PalLedgerCommandHandlerService.stop()
    },
    'payments-command-handler-service': {
      start: () => PaymentsCommandHandlerService.start(),
      stop: () => PaymentsCommandHandlerService.stop()
    },
    'ilp-command-handler-service': {
      start: () => IlpCommandHandlerService.start(),
      stop: () => IlpCommandHandlerService.stop()
    },
    'auth-command-handler-service': {
      start: () => AuthCommandHandlerService.start(),
      stop: () => AuthCommandHandlerService.stop()
    },
    'notifications-command-handler-service': {
      start: () => NotificationsCommandHandlerService.start(),
      stop: () => NotificationsCommandHandlerService.stop()
    },
    'pal-event-handler-service': {
      start: () =>
        PalLedgerEventHandlerService.start(
          undefined, // logger
          factory,
          undefined, // kafkaBuilder
          undefined, // esRepo
          undefined, // readSideRepo
          undefined, // stateEventsConsumer
          undefined, // integrationEventsConsumer
          undefined, // internalEventsConsumer
          undefined, // producer
          undefined, // peerRepo
          undefined, // fxRepo
          undefined, // aseFxService
          undefined, // assetRepo
          telemetry
        ),
      stop: () => PalLedgerEventHandlerService.stop()
    },
    'payments-event-handler-service': {
      start: () => PaymentsEventHandlerService.start(),
      stop: () => PaymentsEventHandlerService.stop()
    },
    'ilp-event-handler-service': {
      start: () => IlpEventHandlerService.start(),
      stop: () => IlpEventHandlerService.stop()
    },
    'auth-event-handler-service': {
      start: () => AuthEventHandlerService.start(),
      stop: () => AuthEventHandlerService.stop()
    },
    'notifications-event-handler-service': {
      start: () => NotificationsEventHandlerService.start(),
      stop: () => NotificationsEventHandlerService.stop()
    },
    'admin-api-service': {
      start: () => AdminApiService.start(),
      stop: () => AdminApiService.stop()
    },
    'open-payments-resource-service': {
      start: () => OpenPaymentsResourceServer.start(),
      stop: () => OpenPaymentsResourceServer.stop()
    },
    'open-payments-auth-service': {
      start: () => OpenPaymentsAuthServer.start(),
      stop: () => OpenPaymentsAuthServer.stop()
    },
    'idp-interaction-service': {
      start: () => IdpInteractionServer.start(),
      stop: () => IdpInteractionServer.stop()
    },
    'http-signature-service': {
      start: () => HttpSignatureService.start(),
      stop: () => HttpSignatureService.stop()
    },
    'ilp-connector-service': {
      start: () => IlpConnectorService.start(),
      stop: () => IlpConnectorService.stop()
    }
  };
  return SERVICE_START_ORDER.map((name) => {
    const lifecycle = lifecycles[name];
    if (!lifecycle) throw new Error(`no registry entry for service "${name}"`);
    return { name, ...lifecycle };
  });
}
