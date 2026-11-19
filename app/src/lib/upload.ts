// A local file (photo, recording, shared image) as an upload for the backend. Web: upload.web.ts.
import { File } from 'expo-file-system'
import type { Upload } from '@shared/types'

export async function fileUpload(uri: string, type: string, name?: string): Promise<Upload> {
  return { name, type, data: await new File(uri).base64() }
}
