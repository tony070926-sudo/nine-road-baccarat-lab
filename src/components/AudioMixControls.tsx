import type {
  CasinoAudioMix,
  CasinoAudioMixChannel,
} from '../audio/casinoAudio'

const CHANNELS: ReadonlyArray<{
  channel: CasinoAudioMixChannel
  label: string
  description: string
}> = [
  { channel: 'master', label: '总音量', description: '控制全部牌桌声音' },
  { channel: 'effects', label: '牌与筹码', description: '真实牌纸、鞋口与筹码录音' },
  { channel: 'ambient', label: '环境声', description: '低音量室内人群氛围' },
  { channel: 'voice', label: '荷官口令', description: '中文停止下注与结果播报' },
]

interface AudioMixControlsProps {
  mix: CasinoAudioMix
  disabled?: boolean
  onChange: (channel: CasinoAudioMixChannel, level: number) => void
}

export function AudioMixControls({
  mix,
  disabled = false,
  onChange,
}: AudioMixControlsProps) {
  return (
    <section className="audio-mix-controls" aria-label="牌桌声音分轨">
      <header>
        <strong>声音分轨</strong>
        <small>各通道会保存在当前浏览器，不写入牌靴快照</small>
      </header>
      <div className="audio-mix-grid">
        {CHANNELS.map(({ channel, label, description }) => {
          const percentage = Math.round(mix[channel] * 100)
          const inputId = `audio-mix-${channel}`
          return (
            <label key={channel} htmlFor={inputId} data-audio-channel={channel}>
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <span className="audio-mix-slider">
                <input
                  id={inputId}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={percentage}
                  disabled={disabled}
                  aria-valuetext={`${percentage}%`}
                  onChange={(event) =>
                    onChange(channel, Number(event.currentTarget.value) / 100)
                  }
                />
                <output htmlFor={inputId}>{percentage}%</output>
              </span>
            </label>
          )
        })}
      </div>
    </section>
  )
}
