import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Note, NoteList } from './notes.shared.js';
import { NotesService } from './notes.service.js';

// GET and POST /notes, as in the API Contract of docs/specs/SMP-2/plan.md.
// Errors are thrown and answered by ApiExceptionFilter in the one error shape.
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(): NoteList {
    return { data: this.notes.list() };
  }

  // Nest also parses form bodies, and lets bodies of other types through
  // unparsed, so the Content-Type is checked first (plan, decision 4).
  @Post()
  create(@Req() req: Request, @Body() body: unknown): Note {
    if (!req.is('application/json')) {
      throw new UnsupportedMediaTypeException();
    }
    return this.notes.create(body);
  }
}
