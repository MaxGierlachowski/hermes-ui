// Voice recording on phones (expo-audio, M4A). Web / desktop: recorder.web.ts (MediaRecorder).
// Same small interface on both: start → stop gives the upload, cancel throws the take away.
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio'
import type { Upload } from '@shared/types'
import { fileUpload } from './upload'

export type StartResult = 'recording' | 'denied'

export type VoiceRecorder = {
  recording: boolean
  millis: number
  /** Asks for the microphone if needed; 'denied' when the system refused it. Other failures throw. */
  start(): Promise<StartResult>
  /** Ends the take; null when nothing was recorded. */
  stop(): Promise<Upload | null>
  cancel(): Promise<void>
}

export function useVoiceRecorder(): VoiceRecorder {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const state = useAudioRecorderState(recorder, 250)
  return {
    recording: state.isRecording,
    millis: state.durationMillis || 0,
    async start() {
      const perm = await requestRecordingPermissionsAsync()
      if (!perm.granted) return 'denied'
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      return 'recording'
    },
    async stop() {
      await recorder.stop()
      await setAudioModeAsync({ allowsRecording: false })
      const uri = recorder.uri
      if (!uri) return null
      const upload = await fileUpload(uri, 'audio/mp4', 'voice.m4a')
      return upload.data ? upload : null
    },
    async cancel() {
      await recorder.stop()
      await setAudioModeAsync({ allowsRecording: false })
    },
  }
}
