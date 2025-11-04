'use strict';

const bodyParser = require('body-parser');
const { HeaderMap } = require('@apollo/server');
const { parse: urlParse } = require('url');

function normalizeHeaders(nodeHeaders) {
  const headers = new HeaderMap();
  for (const [key, value] of Object.entries(nodeHeaders ?? {})) {
    if (value === undefined) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

async function defaultContextFactory({ req }) {
  return { req };
}

function expressMiddleware(server, options = {}) {
  const contextFactory =
    typeof options.context === 'function'
      ? options.context
      : defaultContextFactory;

  const jsonMiddleware =
    options.bodyParserConfig === false
      ? null
      : bodyParser.json(options.bodyParserConfig ?? { limit: '1mb' });

  const handler = async (req, res, next) => {
    try {
      const httpGraphQLRequest = {
        method: (req.method ?? 'POST').toUpperCase(),
        headers: normalizeHeaders(req.headers),
        search: req.url ? (urlParse(req.url).search ?? '') : '',
        body: 'body' in req ? req.body : undefined,
      };

      const httpGraphQLResponse = await server.executeHTTPGraphQLRequest({
        httpGraphQLRequest,
        context: () => Promise.resolve(contextFactory({ req, res })),
      });

      for (const [key, value] of httpGraphQLResponse.headers) {
        res.setHeader(key, value);
      }

      const status = httpGraphQLResponse.status ?? 200;
      res.status(status);

      if (httpGraphQLResponse.body.kind === 'complete') {
        res.send(httpGraphQLResponse.body.string);
        return;
      }

      for await (const chunk of httpGraphQLResponse.body.asyncIterator) {
        res.write(chunk);
      }

      res.end();
    } catch (err) {
      next?.(err);
    }
  };

  if (!jsonMiddleware) {
    return handler;
  }

  return (req, res, next) => {
    jsonMiddleware(req, res, (err) => {
      if (err) {
        next?.(err);
        return;
      }
      handler(req, res, next);
    });
  };
}

module.exports = { expressMiddleware };
