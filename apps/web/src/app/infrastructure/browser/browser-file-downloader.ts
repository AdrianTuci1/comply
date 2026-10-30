import { Injectable } from '@angular/core';
import { FileDownloader } from '../../application/ports/file-downloader';

@Injectable()
export class BrowserFileDownloader extends FileDownloader {
  save(filename: string, content: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
