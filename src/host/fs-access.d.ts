// Minimal typings for the File System Access API and the PWA Launch Queue (Chromium), which
// TypeScript's DOM lib does not include yet.
interface FilePickerAcceptType { description?: string; accept: Record<string, string[]> }
interface OpenFilePickerOptions { types?: FilePickerAcceptType[]; excludeAcceptAllOption?: boolean; multiple?: boolean; id?: string }
interface SaveFilePickerOptions { types?: FilePickerAcceptType[]; suggestedName?: string; excludeAcceptAllOption?: boolean; id?: string }
interface FileSystemHandlePermissionDescriptor { mode?: 'read' | 'readwrite' }
interface FileSystemFileHandle {
  queryPermission?(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(d?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}
interface DataTransferItem { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> }
interface LaunchParams { files: FileSystemFileHandle[] }
interface LaunchQueue { setConsumer(consumer: (params: LaunchParams) => void): void }
interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  launchQueue?: LaunchQueue;
}
