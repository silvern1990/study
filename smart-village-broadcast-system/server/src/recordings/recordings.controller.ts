import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { CreateRecordingDto } from './dto/recording.dto.js';
import { RecordingsService } from './recordings.service.js';

@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  /** multipart/form-data: file(오디오), title */
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'title'],
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        createdById: { type: 'integer' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateRecordingDto,
  ) {
    if (!file) throw new BadRequestException('file is required');
    if (!file.mimetype.startsWith('audio/') && file.mimetype !== 'video/webm') {
      throw new BadRequestException(`unsupported type: ${file.mimetype}`);
    }
    return this.recordings.createFromUpload(file, dto.title, dto.createdById);
  }

  @Get()
  findAll() {
    return this.recordings.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.recordings.findOne(id);
  }

  /** 앱의 "다시 듣기" / 관리자 미리듣기 */
  @Get(':id/audio')
  async audio(@Param('id', ParseIntPipe) id: number) {
    const recording = await this.recordings.findOne(id);
    return new StreamableFile(this.recordings.openStream(recording), {
      type: 'audio/wav',
    });
  }
}
