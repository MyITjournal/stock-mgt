import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let controller: AppController;
  const prisma = { isReachable: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  afterEach(() => jest.resetAllMocks());

  it('reports ok when the database is reachable', async () => {
    prisma.isReachable.mockResolvedValue(true);

    await expect(controller.getHealth()).resolves.toMatchObject({
      status: 'ok',
      database: 'up',
    });
  });

  it('reports degraded when the database is unreachable', async () => {
    prisma.isReachable.mockResolvedValue(false);

    await expect(controller.getHealth()).resolves.toMatchObject({
      status: 'degraded',
      database: 'down',
    });
  });
});
