import { Store } from '@tauri-apps/plugin-store'
import { formatWritingProfile, normalizeWritingProfile, SIXU_WRITING_GUIDANCE, type WritingProfile } from './writing'

export async function loadWritingProfile(): Promise<WritingProfile> {
  const store = await Store.load('sixu-writing.json')
  return normalizeWritingProfile(await store.get('profile'))
}

export async function saveWritingProfile(profile: WritingProfile): Promise<void> {
  const store = await Store.load('sixu-writing.json')
  await store.set('profile', normalizeWritingProfile(profile))
  await store.save()
}

export async function getWritingGuidance(): Promise<string> {
  // Failure to read preferences must not silently replace the user's profile.
  // Let the existing request error UI report a failed read instead.
  const profile = await loadWritingProfile()
  return `${SIXU_WRITING_GUIDANCE}\n\n${formatWritingProfile(profile)}`
}
