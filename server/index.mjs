import { loadRuntimeConfig } from './config/runtimeConfig.mjs';
import { createDependencies } from './clients/index.mjs';
import { buildServices, createApp } from './app.mjs';

const startApiServer = async () => {
  let config;
  try {
    config = loadRuntimeConfig();
  } catch (error) {
    console.error(
      'Runtime configuration failed:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }

  const deps = createDependencies(config);
  const services = buildServices({ config, deps });
  const app = createApp({ config, deps, services });

  if (deps.projectDb) {
    try {
      await services.migrations.requireProjectDb();
      deps.log('Project database schema ready');
    } catch (error) {
      console.error(
        'Project database schema initialization failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  app.listen(config.apiPort, config.apiHost, () => {
    console.log(`AISSIStaint API proxy listening on http://${config.apiHost}:${config.apiPort}`);
    console.log(`Using Keycloak issuer ${config.issuer}`);
    console.log(
      `Using OpenBao ${config.openBaoUrl}/${config.openBaoKvMount}/${config.openBaoPrefix}`,
    );
    console.log(`Using LiteLLM proxy ${config.liteLlmUrl}`);
    if (config.appDatabaseUrl) {
      console.log(
        `Using app database ${config.appDatabaseUrl.replace(/:[^:@/]+@/, ':***@')}`,
      );
    }
  });
};

void startApiServer();
