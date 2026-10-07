import { Pill } from './LookControls';
import { Section } from './ui';
import { useT } from '../lib/i18n';
import { QUALITY_CHOICES, setQualityChoice, useQuality, useQualityChoice } from '../lib/perf';

/**
 * How much moves on this phone: auto / full / light / still (saved on the phone only).
 * Shown in «Ещё» and in the Design tab, where the animations are made.
 */
export function QualityPicker() {
  const t = useT();
  const choice = useQualityChoice();
  const quality = useQuality();
  return (
    <Section title={t.quality.title} footer={t.quality.hint}>
      <div className="flex flex-wrap gap-2 p-3">
        {QUALITY_CHOICES.map((q) => (
          <Pill
            key={q}
            on={choice === q}
            onClick={() => setQualityChoice(q)}
            // On "auto", show what it settled on for this phone.
            label={
              q === 'auto' && choice === 'auto'
                ? `${t.quality.auto} · ${t.quality[quality]}`
                : t.quality[q]
            }
          />
        ))}
      </div>
    </Section>
  );
}
