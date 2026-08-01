import { useId, type ReactNode } from 'react'
import {
  MOTION_PROFILE_OPTIONS,
  type EffectiveMotionProfile,
  type MotionProfile,
} from '../game/motionProfile'

export interface ExperienceSettingsProps {
  motionProfile: MotionProfile
  onMotionProfileChange: (profile: MotionProfile) => void
  effectiveMotionProfile?: EffectiveMotionProfile
  disabled?: boolean
  className?: string
  children?: ReactNode
}

export function ExperienceSettings({
  motionProfile,
  onMotionProfileChange,
  effectiveMotionProfile = motionProfile,
  disabled = false,
  className,
  children,
}: ExperienceSettingsProps) {
  const idPrefix = useId()
  const headingId = `${idPrefix}-heading`
  const paceHelpId = `${idPrefix}-pace-help`
  const classes = ['experience-settings', className].filter(Boolean).join(' ')

  return (
    <section
      className={classes}
      aria-labelledby={headingId}
      data-experience-settings
      data-effective-motion-profile={effectiveMotionProfile}
    >
      <header>
        <strong id={headingId}>体验设置</strong>
        <small>仅保存在当前浏览器，不写入牌靴快照</small>
      </header>

      <fieldset disabled={disabled} aria-describedby={paceHelpId}>
        <legend>牌桌节奏</legend>
        <p id={paceHelpId}>选择发牌、开牌与结算动画的速度。</p>
        <div className="motion-profile-options">
          {MOTION_PROFILE_OPTIONS.map((option) => {
            const inputId = `${idPrefix}-${option.value}`
            const descriptionId = `${inputId}-description`

            return (
              <label
                key={option.value}
                htmlFor={inputId}
                data-motion-profile-option={option.value}
              >
                <input
                  id={inputId}
                  type="radio"
                  name={`${idPrefix}-motion-profile`}
                  value={option.value}
                  checked={motionProfile === option.value}
                  aria-describedby={descriptionId}
                  data-motion-profile-input={option.value}
                  onChange={(event) => {
                    if (event.currentTarget.checked) {
                      onMotionProfileChange(option.value)
                    }
                  }}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small id={descriptionId}>{option.description}</small>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {effectiveMotionProfile === 'reduced' && (
        <p className="reduced-motion-status" role="status" aria-live="polite">
          系统已启用减少动态效果，当前以精简动画运行；所选节奏仍会保存。
        </p>
      )}

      {children !== undefined && children !== null && (
        <div className="experience-settings-extra" data-experience-settings-extra>
          {children}
        </div>
      )}
    </section>
  )
}
