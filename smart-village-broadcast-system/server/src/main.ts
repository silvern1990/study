import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';

async function bootstrap() {
  // mod_xml_curl 은 application/x-www-form-urlencoded 로 요청한다 (Nest 기본 body parser 가 처리)
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Smart Village Broadcast System')
      .setVersion('0.1.0')
      .build(),
  );
  SwaggerModule.setup('docs', app, doc);

  const port = app.get(ConfigService<AppConfig, true>).get('port', { infer: true });
  await app.listen(port);
  Logger.log(`API http://localhost:${port}  /  Swagger http://localhost:${port}/docs`, 'Bootstrap');
}
await bootstrap();
