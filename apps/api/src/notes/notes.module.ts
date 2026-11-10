import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller.js';
import { NotesService } from './notes.service.js';
import { NotesStore } from './notes.store.js';

@Module({
  controllers: [NotesController],
  providers: [NotesService, NotesStore],
})
export class NotesModule {}
