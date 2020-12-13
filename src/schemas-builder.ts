import {v4 as uuid} from 'uuid';
import {
  Header,
  RouteResponse,
  Route,
  Environment,
  HighestMigrationId,
} from './common';

export class SchemasBuilder {
  /**
   * Build a new environment or route response header
   */
  public buildHeader(key = '', value = ''): Header {
    return {key, value};
  }

  /**
   * Build a new route response
   */
  public buildRouteResponse(): RouteResponse {
    return {
      uuid: uuid(),
      body: '{}',
      latency: 0,
      statusCode: 200,
      label: '',
      headers: [this.buildHeader()],
      filePath: '',
      sendFileAsBody: false,
      rules: [],
      rulesOperator: 'OR',
      disableTemplating: false,
    };
  }

  /**
   * Build a new route
   */
  public buildRoute(hasDefaultRouteResponse = true): Route {
    return {
      uuid: uuid(),
      documentation: '',
      method: 'get',
      endpoint: '',
      responses: hasDefaultRouteResponse ? [this.buildRouteResponse()] : [],
      enabled: true,
      randomResponse: false,
    };
  }

  /**
   * Build a new environment
   */
  public buildEnvironment(
    hasDefaultRoute = true,
    hasDefaultHeader = true
  ): Environment {
    return {
      uuid: uuid(),
      lastMigration: HighestMigrationId,
      name: 'New environment',
      endpointPrefix: '',
      latency: 0,
      // TODO: Find an open port
      port: 3000,
      routes: hasDefaultRoute ? [this.buildRoute()] : [],
      proxyMode: false,
      proxyHost: '',
      https: false,
      cors: true,
      headers: hasDefaultHeader
        ? [this.buildHeader('Content-Type', 'application/json')]
        : [],
      proxyReqHeaders: [this.buildHeader()],
      proxyResHeaders: [this.buildHeader()],
    };
  }
}
