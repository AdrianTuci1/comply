/** Port: hands a generated file to the user's device. */
export abstract class FileDownloader {
  abstract save(filename: string, content: string, mimeType: string): void;
}
