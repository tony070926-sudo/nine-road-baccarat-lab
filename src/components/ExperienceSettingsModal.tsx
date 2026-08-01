import type {
  CasinoAudioMix,
  CasinoAudioMixChannel,
} from '../audio/casinoAudio'
import type {
  EffectiveMotionProfile,
  MotionProfile,
} from '../game/motionProfile'
import { AudioMixControls } from './AudioMixControls'
import { ExperienceSettings } from './ExperienceSettings'
import { Modal } from './Modal'

interface ExperienceSettingsModalProps {
  open: boolean
  audioEnabled: boolean
  audioMix: CasinoAudioMix
  motionProfile: MotionProfile
  effectiveMotionProfile: EffectiveMotionProfile
  disabled: boolean
  onAudioMixChange: (channel: CasinoAudioMixChannel, level: number) => void
  onMotionProfileChange: (profile: MotionProfile) => void
  onClose: () => void
}

export function ExperienceSettingsModal({
  open,
  audioEnabled,
  audioMix,
  motionProfile,
  effectiveMotionProfile,
  disabled,
  onAudioMixChange,
  onMotionProfileChange,
  onClose,
}: ExperienceSettingsModalProps) {
  if (!open) return null

  return (
    <Modal title="牌桌体验设置" onClose={onClose}>
      <ExperienceSettings
        motionProfile={motionProfile}
        effectiveMotionProfile={effectiveMotionProfile}
        disabled={disabled}
        onMotionProfileChange={onMotionProfileChange}
      >
        <AudioMixControls
          mix={audioMix}
          disabled={!audioEnabled}
          onChange={onAudioMixChange}
        />
        {!audioEnabled && (
          <p className="experience-settings-note" role="status">
            请先开启牌桌现场音效，再调整各通道音量。
          </p>
        )}
      </ExperienceSettings>
    </Modal>
  )
}
