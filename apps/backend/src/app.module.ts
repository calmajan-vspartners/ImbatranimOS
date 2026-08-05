import { Module, type DynamicModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { StickyNotesModule } from './modules/sticky-notes/sticky-notes.module';
import { TodosModule } from './modules/todos/todos.module';
import { NotesModule } from './modules/notes/notes.module';
import { BookmarksModule } from './modules/bookmarks/bookmarks.module';
import { SystemModule } from './modules/system/system.module';
import { PtyModule } from './modules/pty/pty.module';
import { FilesModule } from './modules/files/files.module';
import { AuthModule } from './modules/auth/auth.module';
import { GitModule } from './modules/git/git.module';
import { HttpProxyModule } from './modules/http-proxy/http-proxy.module';
import { ArchiveModule } from './modules/archive/archive.module';
import { ClockModule } from './modules/clock/clock.module';

// Prod image only: serve the built frontend from STATIC_ROOT on the API
// port, with the SPA index.html fallback. API + health are excluded so
// they keep their own handlers. In dev STATIC_ROOT is unset and Vite
// serves the frontend, so this contributes nothing.
const staticModules: DynamicModule[] = process.env.STATIC_ROOT
  ? [
      ServeStaticModule.forRoot({
        rootPath: process.env.STATIC_ROOT,
        exclude: ['/api/{*path}', '/health'],
      }),
    ]
  : [];

@Module({
  imports: [
    ...staticModules,
    ConfigModule,
    DbModule,
    AuthModule,
    StickyNotesModule,
    TodosModule,
    NotesModule,
    BookmarksModule,
    SystemModule,
    PtyModule,
    FilesModule,
    GitModule,
    HttpProxyModule,
    ArchiveModule,
    ClockModule,
  ],
})
export class AppModule {}
