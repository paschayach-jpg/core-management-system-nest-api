import 'reflect-metadata';
import { Logger } from '@nestjs/common';

process.env.TZ = 'Asia/Bangkok';
Logger.overrideLogger(false); // เงียบ log ของ Nest ระหว่างรันเทสต์
