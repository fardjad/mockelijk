import SwaggerParser from '@apidevtools/swagger-parser';
import {OpenAPIV2, OpenAPIV3} from 'openapi-types';
import {URL} from 'url';

import {Environment, Header, Method, Route, RouteResponse} from './common';
import {SchemasBuilder} from './schemas-builder';
import {methods, statusCodes} from './constants/routes';
import {removeLeadingSlash} from './utils';
import {ResponseRule} from '@mockoon/commons';

const INDENT_SIZE = 2;

type ParametersTypes = 'PATH_PARAMETERS' | 'SERVER_VARIABLES';
type SpecificationVersions = 'SWAGGER' | 'OPENAPI_V3';

/**
 * Convert to and from Swagger/OpenAPI formats
 *
 * OpenAPI specifications: https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.1.md
 * Swagger specifications: https://github.com/OAI/OpenAPI-Specification/blob/master/versions/2.0.md
 */
export class OpenAPIConverterService {
  private schemasBuilder: SchemasBuilder = new SchemasBuilder();

  /**
   * Import Swagger or OpenAPI format
   *
   * @param filePath
   */
  public async import(filePath: string) {
    const parsedAPI:
      | OpenAPIV2.Document
      | OpenAPIV3.Document = await SwaggerParser.dereference(filePath, {
      dereference: {circular: 'ignore'},
    });

    if (this.isSwagger(parsedAPI)) {
      return this.convertFromSwagger(parsedAPI);
    }

    return this.convertFromOpenAPIV3(parsedAPI);
  }

  /**
   * Convert Swagger 2.0 format
   *
   * @param parsedAPI
   */
  private convertFromSwagger(parsedAPI: OpenAPIV2.Document): Environment {
    const newEnvironment = this.schemasBuilder.buildEnvironment(false, false);

    // parse the port
    newEnvironment.port =
      (parsedAPI.host && parseInt(parsedAPI.host.split(':')[1], 10)) ||
      newEnvironment.port;

    if (parsedAPI.basePath) {
      newEnvironment.endpointPrefix = removeLeadingSlash(parsedAPI.basePath);
    }

    newEnvironment.name = parsedAPI.info.title || 'Swagger import';

    newEnvironment.routes = this.createRoutes(parsedAPI, 'SWAGGER');

    return newEnvironment;
  }

  /**
   * Convert OpenAPI 3.0 format
   *
   * @param parsedAPI
   */
  private convertFromOpenAPIV3(parsedAPI: OpenAPIV3.Document): Environment {
    const server: OpenAPIV3.ServerObject[] = parsedAPI.servers || [];

    const url = this.parametersReplace(
      server[0].url,
      'SERVER_VARIABLES',
      server[0].variables
    );

    const newEnvironment = this.schemasBuilder.buildEnvironment(false, false);
    const newUrl = new URL(url);
    newEnvironment.endpointPrefix =
      server &&
      server[0] &&
      server[0].url &&
      removeLeadingSlash(newUrl.pathname);
    newEnvironment.port = Number(newUrl.port);
    newEnvironment.name = parsedAPI.info.title || 'OpenAPI import';
    newEnvironment.routes = this.createRoutes(parsedAPI, 'OPENAPI_V3');
    newEnvironment.proxyMode = server[0]['x-proxy-mode'] === true;
    newEnvironment.proxyHost = server[0]['x-proxy-host'] || '';
    newEnvironment.proxyReqHeaders = server[0]['x-proxy-req-headers'] || [];
    newEnvironment.proxyResHeaders = server[0]['x-proxy-res-headers'] || [];

    return newEnvironment;
  }

  /**
   * Creates routes from imported swagger/OpenAPI document
   *
   * @param parsedAPI
   * @param version
   */
  private createRoutes(
    parsedAPI: OpenAPIV2.Document,
    version: 'SWAGGER'
  ): Route[];
  private createRoutes(
    parsedAPI: OpenAPIV3.Document,
    version: 'OPENAPI_V3'
  ): Route[];
  private createRoutes(
    parsedAPI: OpenAPIV2.Document & OpenAPIV3.Document,
    version: SpecificationVersions
  ): Route[] {
    const routes: Route[] = [];

    Object.keys(parsedAPI.paths).forEach(routePath => {
      Object.keys(parsedAPI.paths[routePath]).forEach(routeMethod => {
        const parsedRoute: OpenAPIV2.OperationObject &
          OpenAPIV3.OperationObject = parsedAPI.paths[routePath][routeMethod];

        if (methods.includes(routeMethod)) {
          const routeResponses: RouteResponse[] = [];

          Object.keys(parsedRoute.responses).forEach(responseStatus => {
            // filter unsupported status codes (i.e. ranges containing "X", 4XX, 5XX, etc)
            if (
              statusCodes.find(
                statusCode => statusCode.code === parseInt(responseStatus, 10)
              )
            ) {
              const routeResponse: OpenAPIV2.ResponseObject &
                OpenAPIV3.ResponseObject =
                parsedRoute.responses[responseStatus];

              let contentTypeHeaders: string[] = [];
              let schema: OpenAPIV2.SchemaObject | OpenAPIV3.SchemaObject = {};

              if (version === 'SWAGGER') {
                contentTypeHeaders =
                  parsedRoute.produces ||
                  parsedRoute.consumes ||
                  parsedAPI.produces ||
                  parsedAPI.consumes ||
                  [];
              } else if (version === 'OPENAPI_V3' && routeResponse.content) {
                contentTypeHeaders = Object.keys(routeResponse.content);
              }

              let examples = [];
              // extract schema
              if (contentTypeHeaders.includes('application/json')) {
                if (version === 'SWAGGER') {
                  schema = (routeResponse as any).schema;
                } else if (version === 'OPENAPI_V3') {
                  const content = (routeResponse as any).content[
                    'application/json'
                  ];
                  schema = content.schema;
                  examples = content.examples || [];
                }
              }

              const exampleSchemas = Object.keys(examples).map(exampleName => {
                return {
                  ...schema,
                  description: exampleName,
                  example: examples[exampleName].value,
                  rules: examples[exampleName]['x-rules'] || [],
                  rulesOperator: examples[exampleName]['x-rules-operator'],
                  disableTemplating:
                    examples[exampleName]['x-disable-templating'],
                };
              });

              exampleSchemas.forEach(s =>
                routeResponses.push(
                  this.createResponse(
                    s,
                    responseStatus,
                    routeResponse,
                    contentTypeHeaders,
                    s.description,
                    s.rules,
                    s.rulesOperator,
                    s.disableTemplating
                  )
                )
              );
            }
          });

          // check if has at least one response
          if (!routeResponses.length) {
            routeResponses.push({
              ...this.schemasBuilder.buildRouteResponse(),
              headers: [
                this.schemasBuilder.buildHeader(
                  'Content-Type',
                  'application/json'
                ),
              ],
              body: '',
            });
          }

          const newRoute: Route = {
            ...this.schemasBuilder.buildRoute(false),
            documentation: parsedRoute.summary || parsedRoute.description || '',
            method: routeMethod as Method,
            endpoint: removeLeadingSlash(
              this.parametersReplace(routePath, 'PATH_PARAMETERS')
            ),
            responses: routeResponses,
          };

          routes.push(newRoute);
        }
      });
    });

    return routes;
  }

  private createResponse(
    schema:
      | OpenAPIV2.SchemaObject
      | OpenAPIV3.ArraySchemaObject
      | OpenAPIV3.NonArraySchemaObject,
    responseStatus: string,
    routeResponse: OpenAPIV2.ResponseObject & OpenAPIV3.ResponseObject,
    contentTypeHeaders: string[],
    label?: string,
    rules: ResponseRule[] = [],
    rulesOperator: 'OR' | 'AND' = 'OR',
    disableTemplating = false
  ) {
    const body =
      schema && Object.keys(schema).length > 0
        ? this.convertJSONSchemaPrimitives(
            JSON.stringify(this.generateSchema(schema), null, INDENT_SIZE)
          )
        : '';

    const response = {
      ...this.schemasBuilder.buildRouteResponse(),
      body,
      statusCode: parseInt(responseStatus, 10),
      label: label || routeResponse.description || '',
      headers: this.buildResponseHeaders(
        contentTypeHeaders,
        routeResponse.headers || {}
      ),
      rules,
      rulesOperator,
      disableTemplating,
    };

    return response;
  }

  /**
   * Build route response headers from 'content' (v3) or 'produces' (v2), and 'headers' objects
   *
   * @param contentTypes
   * @param responseHeaders
   */
  private buildResponseHeaders(
    contentTypes: string[],
    responseHeaders:
      | OpenAPIV2.HeadersObject
      | {
          [key: string]: OpenAPIV3.ReferenceObject | OpenAPIV3.HeaderObject;
        }
  ): Header[] {
    const routeContentTypeHeader = this.schemasBuilder.buildHeader(
      'Content-Type',
      'application/json'
    );

    if (
      contentTypes &&
      contentTypes.length &&
      !contentTypes.includes('application/json')
    ) {
      routeContentTypeHeader.value = contentTypes[0];
    }

    if (responseHeaders) {
      return [
        routeContentTypeHeader,
        ...Object.keys(responseHeaders).map(header =>
          this.schemasBuilder.buildHeader(header, '')
        ),
      ];
    }

    return [routeContentTypeHeader];
  }

  /**
   * Replace parameters in `str`
   *
   * @param str
   * @param parametersType
   * @param parameters
   */
  private parametersReplace<T extends ParametersTypes>(
    str: string,
    parametersType: T,
    parameters?: T extends 'PATH_PARAMETERS'
      ? never
      : {[variable in string]: OpenAPIV3.ServerVariableObject}
  ) {
    return str.replace(/{(\w+)}/gi, (searchValue, replaceValue) => {
      if (parametersType === 'PATH_PARAMETERS') {
        return ':' + replaceValue;
      } else if (parametersType === 'SERVER_VARIABLES') {
        return (parameters as any)[replaceValue].default;
      }
    });
  }

  /**
   * Swagger specification type guard
   *
   * @param parsedAPI
   */
  private isSwagger(parsedAPI: any): parsedAPI is OpenAPIV2.Document {
    return parsedAPI.swagger !== undefined;
  }

  /**
   * Generate a JSON object from a schema
   *
   */
  private generateSchema(
    schema: OpenAPIV2.SchemaObject | OpenAPIV3.SchemaObject
  ) {
    const typeFactories = {
      integer: () => "{{faker 'random.number'}}",
      number: () => "{{faker 'random.number'}}",
      number_float: () => "{{faker 'random.float'}}",
      number_double: () => "{{faker 'random.float'}}",
      string: () => '',
      string_date: () => "{{date '2019' (now) 'yyyy-MM-dd'}}",
      'string_date-time': () => "{{faker 'date.recent' 365}}",
      string_email: () => "{{faker 'internet.email'}}",
      string_uuid: () => "{{faker 'random.uuid'}}",
      boolean: () => "{{faker 'random.boolean'}}",
      array: arraySchema => {
        const newObject = this.generateSchema(arraySchema.items);

        return arraySchema.collectionFormat === 'csv' ? newObject : [newObject];
      },
      object: objectSchema => {
        const newObject = {};
        const {properties} = objectSchema;

        if (properties) {
          Object.keys(properties).forEach(propertyName => {
            newObject[propertyName] = this.generateSchema(
              properties[propertyName]
            );
          });
        }

        return newObject;
      },
    };

    if (schema instanceof Object) {
      let type: string =
        Array.isArray(schema.type) && schema.type.length >= 1
          ? schema.type[0]
          : (schema.type as string);

      // use enum property if present
      if (schema.enum) {
        return `{{oneOf (array '${schema.enum.join("' '")}')}}`;
      }

      // return example if any
      if (schema.example) {
        return schema.example;
      }

      // return default value if any
      if (schema.default) {
        return schema.default;
      }

      let schemaToBuild = schema;

      // check if we have an array of schemas, and take first item
      ['allOf', 'oneOf', 'anyOf'].forEach(propertyName => {
        if (
          Object.prototype.hasOwnProperty.call(schema, propertyName) &&
          schema[propertyName].length > 0
        ) {
          type = schema[propertyName][0].type;
          schemaToBuild = schema[propertyName][0];
        }
      });

      // sometimes we have no type but only 'properties' (=object)
      if (
        !type &&
        schemaToBuild.properties &&
        schemaToBuild.properties instanceof Object
      ) {
        type = 'object';
      }

      const typeFactory =
        typeFactories[`${type}_${schemaToBuild.format}`] || typeFactories[type];

      if (typeFactory) {
        return typeFactory(schemaToBuild);
      }

      return '';
    }
  }

  /**
   * After generating example bodies, remove the quotes around some
   * primitive helpers
   *
   * @param jsonSchema
   */
  private convertJSONSchemaPrimitives(jsonSchema: string) {
    return jsonSchema.replace(
      /"({{faker 'random\.(number|boolean|float)'}})"/g,
      '$1'
    );
  }
}
