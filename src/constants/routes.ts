import {STATUS_CODES} from 'http';

export const methods = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
];

export interface StatusCode {
  code: number;
  text: string;
}

export const statusCodes: StatusCode[] = Object.keys(STATUS_CODES)
  .map(code => Number(code))
  .map(code => ({
    code,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    text: STATUS_CODES[code]!,
  }));
