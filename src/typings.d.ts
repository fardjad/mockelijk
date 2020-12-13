// extend Express' Request type
declare namespace Express {
  export interface Request {
    proxied: boolean;
    bodyForm: any;
    bodyJSON: any;
  }

  export interface Response {
    body: any;
    routeUUID: string;
    routeResponseUUID: string;
  }
}

declare module 'http' {
  export interface Server {
    kill: (callback: () => void) => void;
  }
}

declare module 'https' {
  export interface Server {
    kill: (callback: () => void) => void;
  }
}

declare module 'killable' {
  import * as https from 'https';
  import * as http from 'http';

  function makeKillable<T extends http.Server | https.Server>(server: T): T;

  export = makeKillable;
}
