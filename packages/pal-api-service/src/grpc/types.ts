import { Status } from '@grpc/grpc-js/build/src/constants';
import { sendUnaryData } from '@grpc/grpc-js';

export interface PendingResponse {
  requestId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: sendUnaryData<any>;
  timer: NodeJS.Timeout;
}

export type UnaryResponse<R> = void | {
  error?: { code: Status; message: string };
  resp?: R;
};
