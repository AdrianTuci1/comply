import { Injectable } from '@angular/core';
import { FileTextReader } from '../../application/ports/file-text-reader';

@Injectable()
export class BrowserFileTextReader extends FileTextReader {
  read(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('The file could not be read.'));
      reader.readAsText(file);
    });
  }
}
