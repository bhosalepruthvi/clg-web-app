import { nativeApp } from './transport';

export async function downloadBlob(blob, filename) {
  if (nativeApp) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'), import('@capacitor/share'),
    ]);
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const file = await Filesystem.writeFile({ path: `exports/${Date.now()}-${safeName}`, data, directory: Directory.Cache, recursive: true });
    await Share.share({ title: filename, url: file.uri, dialogTitle: 'Save or share file' });
    return;
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
