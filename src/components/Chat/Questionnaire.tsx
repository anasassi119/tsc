import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { QuestionnaireAnswers, CustomPalette } from '../../stores/agentStore'

interface QuestionnaireProps {
  onSubmit: (answers: QuestionnaireAnswers) => void
}

// ─── Step definitions ──────────────────────────────────────────────────────

const BUILD_TYPES = [
  { id: 'landing', label: 'Landing page', icon: '◻' },
  { id: 'portfolio', label: 'Portfolio / blog', icon: '◻' },
  { id: 'webapp', label: 'Web app / SaaS', icon: '◻' },
  { id: 'ecommerce', label: 'E-commerce', icon: '◻' },
  { id: 'dashboard', label: 'Dashboard / admin', icon: '◻' },
  { id: 'api', label: 'Backend API', icon: '◻' },
  { id: 'mobile', label: 'Mobile / PWA', icon: '◻' },
  { id: 'unsure', label: "Not sure yet", icon: '◻' },
]

const SCOPES = [
  { id: 'prototype', label: 'Quick prototype' },
  { id: 'mvp', label: 'Launch-ready MVP' },
  { id: 'production', label: 'Full production app' },
  { id: 'enterprise', label: 'Enterprise / large-scale' },
]

const AUDIENCES = [
  { id: 'personal', label: 'Just me' },
  { id: 'team', label: 'My team or clients' },
  { id: 'public', label: 'General public' },
  { id: 'b2b', label: 'Business customers' },
]

const BACKEND_NEEDS = [
  { id: 'none', label: 'No backend needed' },
  { id: 'crud', label: 'Simple CRUD + database' },
  { id: 'complex', label: 'Complex business logic' },
  { id: 'realtime', label: 'Real-time features' },
  { id: 'integrations', label: 'Third-party integrations' },
]

// All 25 styles from UI_CREATION.md with visual card treatments
interface DesignStyle {
  id: string
  label: string
  description: string
  cardClass: string
  labelClass?: string
  descClass?: string
}

const DESIGN_STYLES: DesignStyle[] = [
  {
    id: 'neobrutalist',
    label: 'Neobrutalist',
    description: 'Raw, bold, confrontational — structure with impact',
    cardClass: 'bg-zinc-950 border-4 border-white',
    labelClass: 'font-black uppercase tracking-widest text-white text-sm',
    descClass: 'text-zinc-400 font-mono text-xs',
  },
  {
    id: 'swiss',
    label: 'Swiss / International',
    description: 'Grid-based, systematic, ultra-clean typography',
    cardClass: 'bg-white border border-zinc-300',
    labelClass: 'font-light tracking-tight text-zinc-900 text-sm',
    descClass: 'text-zinc-500 text-xs',
  },
  {
    id: 'editorial',
    label: 'Editorial',
    description: 'Magazine-level sophistication — type as art',
    cardClass: 'bg-zinc-900 border-l-4 border-amber-500',
    labelClass: 'italic font-serif text-white text-sm',
    descClass: 'text-zinc-400 text-xs',
  },
  {
    id: 'glassmorphism',
    label: 'Glassmorphism',
    description: 'Translucent layers, blurred depth, floating UI',
    cardClass: 'bg-white/10 backdrop-blur border border-white/20',
    labelClass: 'text-white font-medium text-sm',
    descClass: 'text-white/60 text-xs',
  },
  {
    id: 'retro-futuristic',
    label: 'Retro-futuristic',
    description: "80s vision of the future — refined nostalgia",
    cardClass: 'bg-zinc-900 border border-purple-500',
    labelClass: 'font-mono text-purple-300 text-sm',
    descClass: 'text-purple-400/70 text-xs',
  },
  {
    id: 'bauhaus',
    label: 'Bauhaus',
    description: 'Geometric simplicity — form follows function',
    cardClass: 'bg-red-600 border-none',
    labelClass: 'font-bold text-white text-sm uppercase',
    descClass: 'text-red-200 text-xs',
  },
  {
    id: 'art-deco',
    label: 'Art Deco',
    description: 'Elegant patterns, luxury, vintage sophistication',
    cardClass: 'bg-zinc-900 border-2 border-yellow-600',
    labelClass: 'tracking-widest text-yellow-500 text-sm uppercase',
    descClass: 'text-yellow-600/70 text-xs',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Extreme reduction — maximum whitespace',
    cardClass: 'bg-transparent border border-zinc-700',
    labelClass: 'font-light text-zinc-400 text-sm',
    descClass: 'text-zinc-600 text-xs',
  },
  {
    id: 'flat',
    label: 'Flat',
    description: 'Solid colors, no depth — clean and direct',
    cardClass: 'bg-primary-600 border-none rounded-none',
    labelClass: 'font-medium text-white text-sm',
    descClass: 'text-primary-100 text-xs',
  },
  {
    id: 'material',
    label: 'Material',
    description: 'Cards, subtle shadows — purposeful motion',
    cardClass: 'bg-zinc-800 shadow-lg rounded-md border-none',
    labelClass: 'font-medium text-white text-sm',
    descClass: 'text-zinc-400 text-xs',
  },
  {
    id: 'neumorphic',
    label: 'Neumorphic',
    description: 'Soft shadows, tactile — extruded feel',
    cardClass: 'bg-zinc-800 border border-zinc-700/50',
    labelClass: 'font-medium text-zinc-300 text-sm',
    descClass: 'text-zinc-500 text-xs',
  },
  {
    id: 'monochromatic',
    label: 'Monochromatic',
    description: 'Single color, tonal depth throughout',
    cardClass: 'bg-zinc-700 border border-zinc-600',
    labelClass: 'font-medium text-zinc-200 text-sm',
    descClass: 'text-zinc-400 text-xs',
  },
  {
    id: 'scandinavian',
    label: 'Scandinavian',
    description: 'Hygge, natural materials — warm minimalism',
    cardClass: 'bg-stone-100 border border-stone-200',
    labelClass: 'font-light text-stone-800 text-sm',
    descClass: 'text-stone-500 text-xs',
  },
  {
    id: 'japandi',
    label: 'Japandi',
    description: 'Zen meets hygge — restraint with warmth',
    cardClass: 'bg-stone-900 border-b border-stone-600',
    labelClass: 'font-light text-stone-300 text-sm',
    descClass: 'text-stone-500 text-xs',
  },
  {
    id: 'dark-mode-first',
    label: 'Dark Mode First',
    description: 'High contrast elegance — designed for dark',
    cardClass: 'bg-black border border-zinc-700',
    labelClass: 'font-medium text-white text-sm',
    descClass: 'text-zinc-500 text-xs',
  },
  {
    id: 'modernist',
    label: 'Modernist',
    description: 'Clean lines, functional beauty — timeless',
    cardClass: 'bg-zinc-900 border-t-2 border-primary-500',
    labelClass: 'font-normal text-white text-sm',
    descClass: 'text-zinc-400 text-xs',
  },
  {
    id: 'organic-fluid',
    label: 'Organic / Fluid',
    description: 'Flowing curves, natural shapes — alive',
    cardClass: 'bg-emerald-900/40 border border-emerald-700/50 rounded-3xl',
    labelClass: 'font-medium text-emerald-200 text-sm',
    descClass: 'text-emerald-400/60 text-xs',
  },
  {
    id: 'corporate',
    label: 'Corporate Professional',
    description: 'Trust-building, established — refined authority',
    cardClass: 'bg-primary-900 border border-primary-700',
    labelClass: 'font-medium text-white text-sm',
    descClass: 'text-primary-300 text-xs',
  },
  {
    id: 'tech-forward',
    label: 'Tech Forward',
    description: 'Innovative, future-focused — precise and clean',
    cardClass: 'bg-cyan-950 border border-cyan-500/50',
    labelClass: 'font-mono text-cyan-300 text-sm',
    descClass: 'text-cyan-400/60 text-xs',
  },
  {
    id: 'luxury-minimal',
    label: 'Luxury Minimal',
    description: 'Premium restraint — high-end simplicity',
    cardClass: 'bg-zinc-900 border border-zinc-600',
    labelClass: 'tracking-[0.2em] font-thin text-zinc-200 text-sm uppercase',
    descClass: 'text-zinc-500 text-xs',
  },
  {
    id: 'neo-geo',
    label: 'Neo-Geo',
    description: 'Geometric patterns — mathematical beauty',
    cardClass: 'bg-zinc-950 border-2 border-orange-500',
    labelClass: 'font-bold text-orange-400 text-sm',
    descClass: 'text-orange-500/60 text-xs',
  },
  {
    id: 'kinetic',
    label: 'Kinetic',
    description: 'Motion-driven — dynamic but controlled',
    cardClass: 'bg-violet-950 border border-violet-500',
    labelClass: 'font-medium text-violet-200 text-sm',
    descClass: 'text-violet-400/60 text-xs',
  },
  {
    id: 'gradient-modern',
    label: 'Gradient Modern',
    description: 'Sophisticated color transitions — depth through gradients',
    cardClass: 'bg-gradient-to-br from-pink-900 to-purple-900 border-none',
    labelClass: 'font-medium text-white text-sm',
    descClass: 'text-pink-200/70 text-xs',
  },
  {
    id: 'typography-first',
    label: 'Typography First',
    description: 'Type as the hero — letterforms as design',
    cardClass: 'bg-zinc-950 border-none',
    labelClass: 'font-black text-white text-lg leading-none',
    descClass: 'text-zinc-500 text-xs',
  },
  {
    id: 'metropolitan',
    label: 'Metropolitan',
    description: 'Urban sophistication — cultural depth',
    cardClass: 'bg-zinc-800 border-l-2 border-zinc-400',
    labelClass: 'font-medium text-zinc-200 text-sm',
    descClass: 'text-zinc-400 text-xs',
  },
]

const COLOR_MOODS = [
  { id: 'neutral', label: 'Neutral tones', swatch: 'bg-zinc-500' },
  { id: 'vibrant', label: 'Vibrant + colorful', swatch: 'bg-gradient-to-r from-orange-500 to-pink-500' },
  { id: 'earth', label: 'Earth tones', swatch: 'bg-amber-700' },
  { id: 'high-contrast', label: 'High contrast / B&W', swatch: 'bg-gradient-to-r from-black to-white' },
  { id: 'dark-moody', label: 'Deep + moody darks', swatch: 'bg-zinc-900 border border-zinc-600' },
  { id: 'pastel', label: 'Soft pastels', swatch: 'bg-gradient-to-r from-pink-200 to-purple-200' },
]

const DEFAULT_CUSTOM_PALETTE: CustomPalette = {
  background: '#171315',
  primary: '#e16786',
  secondary: '#b29da1',
  tertiary: '#352d31',
  text: '#efe8e8',
}

const PALETTE_SLOTS: { key: keyof CustomPalette; label: string; hint: string }[] = [
  { key: 'background', label: 'Background', hint: 'Main page background' },
  { key: 'primary', label: 'Primary', hint: 'Buttons, links, highlights' },
  { key: 'secondary', label: 'Secondary', hint: 'Supporting accents' },
  { key: 'tertiary', label: 'Tertiary', hint: 'Subtle backgrounds, borders' },
  { key: 'text', label: 'Text', hint: 'Body copy and headings' },
]

const PRIORITIES = [
  { id: 'beautiful-ui', label: 'Beautiful UI' },
  { id: 'fast-ship', label: 'Fast to ship' },
  { id: 'performance', label: 'Rock-solid performance' },
  { id: 'security', label: 'Security first' },
  { id: 'scalability', label: 'Built to scale' },
  { id: 'dx', label: 'Great dev experience' },
]

const TIMELINES = [
  { id: 'asap', label: 'Ship it ASAP' },
  { id: 'iterative', label: 'Feature by feature' },
  { id: 'longterm', label: 'Long-term project' },
]

// ─── Helpers ───────────────────────────────────────────────────────────────

function isFrontendProject(buildTypes: string[], backendNeeds: string[]): boolean {
  const frontendBuilds = ['landing', 'portfolio', 'webapp', 'ecommerce', 'dashboard', 'mobile', 'unsure']
  const hasFrontendBuild = buildTypes.some((t) => frontendBuilds.includes(t))
  const backendOnly = buildTypes.length > 0 && buildTypes.every((t) => t === 'api') && backendNeeds.length > 0
  return hasFrontendBuild && !backendOnly
}

// ─── Sub-components ────────────────────────────────────────────────────────

interface ChipProps {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  multi?: boolean
}

function Chip({ selected, onClick, children, multi }: ChipProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className={[
        'px-4 py-2.5 rounded-lg text-sm font-medium transition-colors text-left',
        selected
          ? 'bg-primary-500/20 text-primary-100 ring-2 ring-primary-400/70 ring-offset-2 ring-offset-surface-950 border border-primary-400/40'
          : 'bg-surface-800/80 text-surface-200 border border-surface-700 hover:border-primary-500/45 hover:text-surface-50',
        multi ? '' : '',
      ].join(' ')}
    >
      {children}
    </motion.button>
  )
}

interface StyleCardProps {
  style: DesignStyle
  selected: boolean
  onClick: () => void
}

function StyleCard({ style, selected, onClick }: StyleCardProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={[
        'relative p-3 rounded-lg text-left transition-all cursor-pointer',
        style.cardClass,
        selected ? 'ring-2 ring-primary-400/70 ring-offset-2 ring-offset-surface-950' : 'opacity-80 hover:opacity-100',
      ].join(' ')}
    >
      {selected && (
        <div className="absolute top-2 right-2 w-5 h-5 bg-white rounded-full flex items-center justify-center flex-shrink-0">
          <svg className="w-3 h-3 text-zinc-900" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      )}
      <p className={`mb-1 ${style.labelClass ?? 'font-medium text-white text-sm'}`}>{style.label}</p>
      <p className={style.descClass ?? 'text-xs text-zinc-400'}>{style.description}</p>
    </motion.button>
  )
}

// ─── Step slide variants ───────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: number) => ({ x: dir * 60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -60, opacity: 0 }),
}

const slideTransition = { duration: 0.28, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }

// ─── Main component ────────────────────────────────────────────────────────

export function Questionnaire({ onSubmit }: QuestionnaireProps) {
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)

  // Answers state
  const [buildTypes, setBuildTypes] = useState<string[]>([])
  const [scope, setScope] = useState<string>('')
  const [audience, setAudience] = useState<string>('')
  const [backendNeeds, setBackendNeeds] = useState<string[]>([])
  const [designStyle, setDesignStyle] = useState<string | null>(null)
  const [colorMood, setColorMood] = useState<string | null>(null)
  const [customPalette, setCustomPalette] = useState<CustomPalette>({ ...DEFAULT_CUSTOM_PALETTE })
  const [priorities, setPriorities] = useState<string[]>([])
  const [timeline, setTimeline] = useState<string>('')

  const showFrontendSteps = isFrontendProject(buildTypes, backendNeeds)

  // Compute the actual step sequence based on skip logic
  const getStepSequence = useCallback((): string[] => {
    const steps = ['buildType', 'scope', 'audience', 'backend']
    if (showFrontendSteps) {
      steps.push('designStyle', 'colorMood')
    }
    steps.push('priorities', 'timeline')
    return steps
  }, [showFrontendSteps])

  const stepSequence = getStepSequence()
  const totalSteps = stepSequence.length
  const currentStepId = stepSequence[step]
  const progress = (step / (totalSteps - 1)) * 100

  const canAdvance = (): boolean => {
    switch (currentStepId) {
      case 'buildType': return buildTypes.length > 0
      case 'scope': return scope !== ''
      case 'audience': return audience !== ''
      case 'backend': return backendNeeds.length > 0
      case 'designStyle': return designStyle !== null
      case 'colorMood': return colorMood !== null
      case 'priorities': return priorities.length > 0
      case 'timeline': return timeline !== ''
      default: return false
    }
  }

  const advance = useCallback(() => {
    if (!canAdvance()) return
    if (step < totalSteps - 1) {
      setDir(1)
      setStep((s) => s + 1)
    } else {
      handleSubmit()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, totalSteps, canAdvance])

  const back = useCallback(() => {
    if (step > 0) {
      setDir(-1)
      setStep((s) => s - 1)
    }
  }, [step])

  const handleSubmit = () => {
    onSubmit({
      buildTypes,
      scope,
      audience,
      backendNeeds,
      designStyle: showFrontendSteps ? designStyle : null,
      colorMood: showFrontendSteps ? colorMood : null,
      customPalette: showFrontendSteps && colorMood === 'custom' ? customPalette : null,
      priorities,
      timeline,
    })
  }

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && canAdvance()) advance()
      if (e.key === 'ArrowLeft' && step > 0) back()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canAdvance, advance, back, step])

  const isLast = step === totalSteps - 1

  return (
    <div className="flex flex-col h-full w-full items-center justify-center px-6 py-8 overflow-hidden">
      {/* Progress bar */}
      <div className="w-full max-w-2xl mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-surface-500 font-mono">
            {step + 1} / {totalSteps}
          </span>
          {step > 0 && (
            <button
              type="button"
              onClick={back}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary-500/35 bg-primary-500/10 px-2.5 py-1 text-xs font-medium text-primary-200 hover:bg-primary-500/20 hover:text-primary-100 transition-colors"
            >
              <span aria-hidden>←</span> Back
            </button>
          )}
        </div>
        <div className="h-0.5 w-full bg-surface-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary-400 rounded-full"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="w-full max-w-2xl flex-1 flex flex-col justify-center overflow-hidden">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={currentStepId}
            custom={dir}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={slideTransition}
            className="flex flex-col gap-6"
          >
            {currentStepId === 'buildType' && (
              <StepBuildType selected={buildTypes} onToggle={(id) => {
                setBuildTypes((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
              }} />
            )}
            {currentStepId === 'scope' && (
              <StepSingle
                question="How big is this project?"
                hint="This shapes how we plan the architecture and timeline."
                options={SCOPES}
                selected={scope}
                onSelect={setScope}
              />
            )}
            {currentStepId === 'audience' && (
              <StepSingle
                question="Who's this built for?"
                hint="Knowing your users helps define features, security, and scale."
                options={AUDIENCES}
                selected={audience}
                onSelect={setAudience}
              />
            )}
            {currentStepId === 'backend' && (
              <StepMulti
                question="What does the backend need to do?"
                hint="Select everything that applies — we'll pick the right stack."
                options={BACKEND_NEEDS}
                selected={backendNeeds}
                onToggle={(id) => {
                  setBackendNeeds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
                }}
              />
            )}
            {currentStepId === 'designStyle' && (
              <StepDesignStyle selected={designStyle} onSelect={setDesignStyle} />
            )}
            {currentStepId === 'colorMood' && (
              <StepColorMood
                selected={colorMood}
                onSelect={setColorMood}
                customPalette={customPalette}
                onPaletteChange={(key, value) =>
                  setCustomPalette((prev) => ({ ...prev, [key]: value }))
                }
              />
            )}
            {currentStepId === 'priorities' && (
              <StepMulti
                question="What matters most to you?"
                hint="Pick up to three — we'll optimise for these above all else."
                options={PRIORITIES}
                selected={priorities}
                onToggle={(id) => {
                  setPriorities((prev) =>
                    prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : prev
                  )
                }}
              />
            )}
            {currentStepId === 'timeline' && (
              <StepSingle
                question="What's the timeline looking like?"
                hint="This affects how we scope milestones."
                options={TIMELINES}
                selected={timeline}
                onSelect={setTimeline}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* CTA button */}
      <div className="w-full max-w-2xl mt-8">
        <motion.button
          type="button"
          onClick={advance}
          disabled={!canAdvance()}
          whileHover={canAdvance() ? { scale: 1.02 } : {}}
          whileTap={canAdvance() ? { scale: 0.98 } : {}}
          className={[
            'w-full py-3 rounded-lg font-medium text-sm transition-all',
            canAdvance()
              ? 'bg-primary-500 text-primary-50 hover:bg-primary-400'
              : 'bg-surface-800 text-surface-500 cursor-not-allowed',
          ].join(' ')}
        >
          {isLast ? "Let's build it →" : 'Continue →'}
        </motion.button>
      </div>
    </div>
  )
}

// ─── Step sub-components ───────────────────────────────────────────────────

function StepBuildType({
  selected,
  onToggle,
}: {
  selected: string[]
  onToggle: (id: string) => void
}) {
  return (
    <div className='p-4'>
      <div>
        <h2 className="text-2xl font-semibold text-surface-50 mb-1">What are you building?</h2>
        <p className="text-sm text-surface-400 mb-2">Select everything that applies.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {BUILD_TYPES.map((bt) => (
          <Chip key={bt.id} selected={selected.includes(bt.id)} onClick={() => onToggle(bt.id)} multi>
            {bt.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function StepSingle({
  question,
  hint,
  options,
  selected,
  onSelect,
}: {
  question: string
  hint: string
  options: { id: string; label: string }[]
  selected: string
  onSelect: (id: string) => void
}) {
  return (
    <div className='p-4'>
      <div>
        <h2 className="text-2xl font-semibold text-surface-50 mb-1">{question}</h2>
        <p className="text-sm text-surface-400 mb-2">{hint}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => (
          <Chip key={opt.id} selected={selected === opt.id} onClick={() => onSelect(opt.id)}>
            {opt.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function StepMulti({
  question,
  hint,
  options,
  selected,
  onToggle,
}: {
  question: string
  hint: string
  options: { id: string; label: string }[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  return (
    <div className='p-4'>
      <div>
        <h2 className="text-2xl font-semibold text-surface-50 mb-1">{question}</h2>
        <p className="text-sm text-surface-400 mb-2">{hint}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => (
          <Chip key={opt.id} selected={selected.includes(opt.id)} onClick={() => onToggle(opt.id)} multi>
            {opt.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}

function StepDesignStyle({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className='p-4'>
      <div>
        <h2 className="text-2xl font-semibold text-surface-50 mb-1">Pick a design style</h2>
        <p className="text-sm text-surface-400 mb-2">
          Choose your vibe.
        </p>
      </div>
      <div
        className="grid grid-cols-3 gap-3 max-h-[340px] overflow-y-auto p-4"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#6e595f transparent' }}
      >
        {DESIGN_STYLES.map((style) => (
          <StyleCard
            key={style.id}
            style={style}
            selected={selected === style.id}
            onClick={() => onSelect(style.id)}
          />
        ))}
      </div>
    </div>
  )
}

function ColorSwatch({
  color,
  onChange,
  label,
  hint,
}: {
  color: string
  onChange: (val: string) => void
  label: string
  hint: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="group relative flex flex-col items-center gap-2 p-3 rounded-xl bg-zinc-800/60 border border-zinc-700 hover:border-zinc-500 transition-all"
      >
        {/* Color circle */}
        <div
          className="w-10 h-10 rounded-full border-2 border-zinc-600 group-hover:border-zinc-400 transition-colors shadow-lg flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        {/* Hidden native color input */}
        <input
          ref={inputRef}
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          aria-label={label}
        />
        <span className="text-xs font-medium text-zinc-300 group-hover:text-white transition-colors">{label}</span>
        <span
          className="text-[10px] font-mono text-zinc-600 group-hover:text-zinc-400 transition-colors"
        >
          {color.toUpperCase()}
        </span>
      </button>
      <p className="text-[10px] text-zinc-600 text-center leading-tight">{hint}</p>
    </div>
  )
}

function StepColorMood({
  selected,
  onSelect,
  customPalette,
  onPaletteChange,
}: {
  selected: string | null
  onSelect: (id: string) => void
  customPalette: CustomPalette
  onPaletteChange: (key: string, value: string) => void
}) {
  return (
    <div className="p-4 flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-semibold text-surface-50 mb-1">What's the color mood?</h2>
        <p className="text-sm text-surface-400">The emotional palette that shapes every screen.</p>
      </div>

      {/* Preset moods */}
      <div className="grid grid-cols-2 gap-2">
        {COLOR_MOODS.map((mood) => (
          <motion.button
            key={mood.id}
            type="button"
            onClick={() => onSelect(mood.id)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className={[
              'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left',
              selected === mood.id
                ? 'bg-primary-500/20 text-primary-100 ring-2 ring-primary-400/70 ring-offset-2 ring-offset-surface-950 border border-primary-400/40'
                : 'bg-surface-800/80 text-surface-200 border border-surface-700 hover:border-primary-500/45 hover:text-surface-50',
            ].join(' ')}
          >
            <span className={`w-5 h-5 rounded-full flex-shrink-0 ${mood.swatch}`} />
            {mood.label}
          </motion.button>
        ))}

        {/* Choose your own option */}
        <motion.button
          type="button"
          onClick={() => onSelect('custom')}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className={[
            'col-span-2 flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left',
            selected === 'custom'
              ? 'bg-primary-500/20 text-primary-100 ring-2 ring-primary-400/70 ring-offset-2 ring-offset-surface-950 border border-primary-400/40'
              : 'bg-surface-800/80 text-surface-200 border border-dashed border-surface-600 hover:border-primary-500/45 hover:text-surface-50',
          ].join(' ')}
        >
          {/* Mini palette preview */}
          <span className="flex gap-0.5 flex-shrink-0">
            {(['background', 'primary', 'secondary', 'tertiary', 'text'] as (keyof CustomPalette)[]).map((k) => (
              <span
                key={k}
                className="w-3.5 h-3.5 rounded-full border border-black/20"
                style={{ backgroundColor: customPalette[k] }}
              />
            ))}
          </span>
          Choose your own palette
        </motion.button>
      </div>

      {/* Custom palette pickers — revealed when 'custom' is selected */}
      <AnimatePresence>
        {selected === 'custom' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-2 border-t border-surface-800">
              <p className="text-xs text-surface-400 mb-3">Click any swatch to open the color picker.</p>
              <div className="grid grid-cols-5 gap-2">
                {PALETTE_SLOTS.map(({ key, label, hint }) => (
                  <ColorSwatch
                    key={key}
                    color={customPalette[key]}
                    onChange={(val) => onPaletteChange(key, val)}
                    label={label}
                    hint={hint}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
