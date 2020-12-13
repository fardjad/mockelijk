#!/usr/bin/env node

import minimist from 'minimist';
import {
  createLogger,
  format as logFormat,
  transports as logsTransports,
} from 'winston';
import {format} from 'util';
import {readFile as readJSONFile} from 'jsonfile';

import {Environment, ServerErrorCodes, Transaction} from './common';
import {Messages} from './constants/messages';
import {MockoonServer} from './mockoon-server';
import {OpenAPIConverterService} from './openapi-converter';

const logger = createLogger({
  level: 'info',
  format: logFormat.combine(logFormat.timestamp(), logFormat.json()),
  transports: [new logsTransports.Console()],
});

const argv = minimist<{data: string}>(process.argv.slice(2));

const addEventListeners = function (
  server: MockoonServer,
  environment: Environment
) {
  server.on('started', () => {
    logger.info(format(Messages.SERVER.STARTED, environment.port));

    if (process.send) {
      process.send('ready');
    }
  });

  server.on('error', (errorCode, error) => {
    // throw blocking errors
    if (
      errorCode === ServerErrorCodes.PORT_ALREADY_USED ||
      errorCode === ServerErrorCodes.PORT_INVALID ||
      errorCode === ServerErrorCodes.UNKNOWN_SERVER_ERROR
    ) {
      throw new Error(error?.message);
    }

    // report non blocking errors
    if (
      [
        ServerErrorCodes.REQUEST_BODY_PARSE,
        ServerErrorCodes.ROUTE_FILE_SERVING_ERROR,
        ServerErrorCodes.ROUTE_SERVING_ERROR,
        ServerErrorCodes.ROUTE_CREATION_ERROR,
        ServerErrorCodes.ROUTE_CREATION_ERROR_REGEX,
        ServerErrorCodes.PROXY_ERROR,
      ].indexOf(errorCode) > -1
    ) {
      logger.error(error?.message);
    }
  });

  server.on('creating-proxy', () => {
    logger.info(format(Messages.SERVER.CREATING_PROXY, environment.proxyHost));
  });

  server.on('transaction-complete', (transaction: Transaction) => {
    logger.info(
      `${transaction.request.method} ${transaction.request.urlPath} | ${
        transaction.response.statusCode
      }${transaction.proxied ? ' | proxied' : ''}`
    );
  });

  server.on('stopped', () => {
    logger.info(Messages.SERVER.STOPPED);
  });

  process.on('SIGINT', () => {
    server.stop();
  });
};

const start = async (path: string) => {
  const openApiConverter = new OpenAPIConverterService();
  const jsonData = await readJSONFile(path, 'utf-8');
  const environment: Environment = await openApiConverter.import(jsonData);
  console.log(environment);
  const server = new MockoonServer(environment, {
    logProvider: () => ({
      log: logger.log.bind(logger),
      debug: logger.debug.bind(logger),
      info: logger.info.bind(logger),
      warn: logger.warn.bind(logger),
      error: logger.error.bind(logger),
    }),
  });

  addEventListeners(server, environment);

  server.start();
};

if (argv.data) {
  start(argv.data).catch(err => {
    throw err;
  });
}
