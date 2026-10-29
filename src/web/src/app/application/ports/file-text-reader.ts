/** Port: reads a user-selected file as text. */
export abstract class FileTextReader {
  abstract read(file: File): Promise<string>;
}
