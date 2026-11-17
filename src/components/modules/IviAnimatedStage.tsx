import React from 'react';
import { motion } from 'motion/react';
import { Volume2 } from 'lucide-react';

interface IviAnimatedStageProps {
  traineeName: string;
  moduleTitle?: string;
  fieldLabel?: string;
  stepNumber: number;
  totalSteps: number;
  isSpeaking: boolean;
  selectedVoice: 'Aoede' | 'Kore' | 'Zephyr';
  onChangeVoice: (voice: 'Aoede' | 'Kore' | 'Zephyr') => void;
}

export const IviAnimatedStage: React.FC<IviAnimatedStageProps> = ({
  traineeName,
  moduleTitle,
  fieldLabel,
  stepNumber,
  totalSteps,
  isSpeaking,
  selectedVoice,
  onChangeVoice,
}) => {
  // Movimentação calma, natural e contida na sala de aula para não tirar o foco do conteúdo
  const walkXFrames = [-16, -4, 10, 20, 8, -8, -16];
  const walkCycleDuration = isSpeaking ? 16 : 22;

  const legLeftAngles = [6, -6, 6, -5, 5, -6, 6];
  const legRightAngles = [-6, 6, -6, 5, -5, 6, -6];
  const armRightUpperAngles = isSpeaking
    ? [-14, -30, -20, -36, -18, -26, -14]
    : [-8, -14, -10, -15, -9, -12, -8];
  const armRightForeAngles = isSpeaking
    ? [-14, -24, -12, -26, -15, -20, -14]
    : [-8, -12, -7, -13, -8, -10, -8];
  const armLeftUpperAngles = [5, 10, 4, 9, 6, 11, 5];

  return (
    <div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
      {/* Compact Classroom Header */}
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0 dark:border-slate-800">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-blue-700 truncate dark:text-blue-300">
            Sala de Aula Invicta · Instrutora Ivi
          </div>
          <h3 className="font-display text-sm font-bold text-slate-900 truncate dark:text-slate-100">
            {moduleTitle || 'Treinamento Oficial'} · Etapa {stepNumber} de {Math.max(1, totalSteps)}
          </h3>
        </div>
        <div className="text-[11px] font-medium text-slate-600 shrink-0 dark:text-slate-300">
          Turma de {traineeName}
        </div>
      </div>

      {/* Classroom Scene Canvas with Ivi Wearing Invicta Polo Shirt */}
      <div className="relative flex-1 w-full min-h-[385px] bg-slate-100 dark:bg-slate-900 overflow-hidden flex flex-col justify-between">
        <div className="relative flex-1 w-full flex items-end justify-center">
          <svg
            viewBox="0 0 400 350"
            className="w-full h-[335px] sm:h-[365px] max-w-[460px] select-none"
            role="img"
            aria-label={`Ivi Instrutora da Invicta na sala de aula apresentando para ${traineeName}`}
          >
            <defs>
              <linearGradient id="classroomWallGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#f8fafc" />
                <stop offset="100%" stopColor="#e2e8f0" />
              </linearGradient>
              <linearGradient id="classroomFloorGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#cbd5e1" />
                <stop offset="100%" stopColor="#94a3b8" />
              </linearGradient>
              <linearGradient id="classroomDaylightGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#dbeafe" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#eff6ff" stopOpacity="0.2" />
              </linearGradient>
              <linearGradient id="iviPoloGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#17345e" />
                <stop offset="100%" stopColor="#0c203e" />
              </linearGradient>
              <linearGradient id="iviPantsGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#64748b" />
                <stop offset="100%" stopColor="#475569" />
              </linearGradient>
              <linearGradient id="iviHairGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#5c3621" />
                <stop offset="100%" stopColor="#3b2012" />
              </linearGradient>
            </defs>

            {/* Classroom Back Wall */}
            <rect x="0" y="0" width="400" height="295" fill="url(#classroomWallGrad)" />

            {/* Ceiling Recessed Acoustic Strip & Lights */}
            <rect x="0" y="0" width="400" height="22" fill="#e2e8f0" />
            <rect x="65" y="6" width="90" height="6" rx="3" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1" />
            <rect x="245" y="6" width="90" height="6" rx="3" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1" />

            {/* Soft Classroom Window (Left Background) */}
            <g transform="translate(18, 38)">
              <rect x="0" y="0" width="68" height="104" rx="4" fill="url(#classroomDaylightGrad)" stroke="#cbd5e1" strokeWidth="2" />
              <line x1="34" y1="0" x2="34" y2="104" stroke="#cbd5e1" strokeWidth="1.5" />
              <line x1="0" y1="52" x2="68" y2="52" stroke="#cbd5e1" strokeWidth="1.5" />
            </g>

            {/* Classroom Wall Whiteboard Frame Behind Instructor */}
            <g transform="translate(106, 26)">
              <rect x="0" y="0" width="268" height="156" rx="6" fill="#ffffff" stroke="#94a3b8" strokeWidth="3" />
              <rect x="8" y="8" width="252" height="140" rx="3" fill="#f8fafc" />
              {/* Institutional Classroom Header on Wall Board */}
              <rect x="16" y="14" width="236" height="22" rx="3" fill="#0f2340" />
              <text x="134" y="28.5" textAnchor="middle" fontSize="9.2" fontWeight="700" fill="#fbbf24">
                INVICTA ASSESSORIA · SALA DE AULA
              </text>
              {/* Subtle Diagram Motif Drawn on Background Whiteboard */}
              <rect x="24" y="50" width="60" height="24" rx="4" fill="#dbeafe" stroke="#60a5fa" strokeWidth="1" />
              <rect x="104" y="50" width="60" height="24" rx="4" fill="#dbeafe" stroke="#60a5fa" strokeWidth="1" />
              <rect x="184" y="50" width="60" height="24" rx="4" fill="#fef3c7" stroke="#f59e0b" strokeWidth="1" />
              <line x1="84" y1="62" x2="104" y2="62" stroke="#64748b" strokeWidth="1.5" />
              <line x1="164" y1="62" x2="184" y2="62" stroke="#64748b" strokeWidth="1.5" />
              <line x1="24" y1="92" x2="230" y2="92" stroke="#e2e8f0" strokeWidth="2" />
              <line x1="24" y1="108" x2="195" y2="108" stroke="#e2e8f0" strokeWidth="2" />
              {/* Marker Tray on Whiteboard Bottom */}
              <rect x="10" y="150" width="248" height="6" rx="2" fill="#cbd5e1" />
              <rect x="210" y="146" width="16" height="4" rx="1" fill="#1d4ed8" />
              <rect x="230" y="146" width="16" height="4" rx="1" fill="#d97706" />
            </g>

            {/* Wall Wainscot Trim & Floor */}
            <rect x="0" y="220" width="400" height="75" fill="#dde5ee" />
            <line x1="0" y1="220" x2="400" y2="220" stroke="#cbd5e1" strokeWidth="2" />
            <rect x="0" y="295" width="400" height="55" fill="url(#classroomFloorGrad)" />
            <line x1="0" y1="295" x2="400" y2="295" stroke="#94a3b8" strokeWidth="1.5" />

            {/* Instructor Wooden Podium / Desk Corner on Left */}
            <g transform="translate(14, 212)">
              <rect x="0" y="6" width="76" height="92" rx="4" fill="#92400e" />
              <rect x="0" y="0" width="84" height="10" rx="3" fill="#b45309" />
              <rect x="10" y="18" width="56" height="68" rx="2" fill="#78350f" />
              {/* Manual Notebook on Desk */}
              <rect x="14" y="-7" width="38" height="7" rx="1.5" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.8" />
            </g>

            {/* Subtle Floor Shadow Synced Calmly to Ivi */}
            <motion.g
              animate={{ x: walkXFrames }}
              transition={{ duration: walkCycleDuration, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ellipse cx="222" cy="322" rx="44" ry="8" fill="#0f172a" fillOpacity="0.2" />
            </motion.g>

            {/* Full-Body Instructor Ivi (Always Facing Forward Showing Invicta Polo Shirt) */}
            <motion.g
              animate={{
                x: walkXFrames,
                y: [0, -1.8, 0, -1.4, 0, -1.6, 0],
              }}
              transition={{
                x: { duration: walkCycleDuration, repeat: Infinity, ease: 'easeInOut' },
                y: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' },
              }}
            >
              <g transform="translate(222, 22)">
                {/* LEFT LEG (Hip Pivot x=-12, y=196) */}
                <g transform="translate(-12, 196)">
                  <motion.g
                    animate={{ rotate: legLeftAngles }}
                    transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <path
                      d="M -11 0 L 11 0 L 9 102 L -7 102 Z"
                      fill="url(#iviPantsGrad)"
                      stroke="#334155"
                      strokeWidth="1.2"
                    />
                    <g transform="translate(0, 102)">
                      <path
                        d="M -8 0 L 9 0 L 16 11 C 17 14 14 16 8 16 L -10 16 C -12 16 -12 10 -8 0 Z"
                        fill="#1e293b"
                      />
                      <rect x="-10" y="13" width="26" height="3" rx="1.5" fill="#0f172a" />
                    </g>
                  </motion.g>
                </g>

                {/* RIGHT LEG (Hip Pivot x=12, y=196) */}
                <g transform="translate(12, 196)">
                  <motion.g
                    animate={{ rotate: legRightAngles }}
                    transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <path
                      d="M -11 0 L 11 0 L 10 102 L -8 102 Z"
                      fill="url(#iviPantsGrad)"
                      stroke="#334155"
                      strokeWidth="1.2"
                    />
                    <g transform="translate(0, 102)">
                      <path
                        d="M -9 0 L 9 0 L 17 11 C 18 14 15 16 9 16 L -9 16 C -11 16 -11 10 -9 0 Z"
                        fill="#1e293b"
                      />
                      <rect x="-10" y="13" width="27" height="3" rx="1.5" fill="#0f172a" />
                    </g>
                  </motion.g>
                </g>

                {/* LEFT ARM HOLDING INVICTA LESSON TABLET */}
                <g transform="translate(-27, 106)">
                  <motion.g
                    animate={{ rotate: armLeftUpperAngles }}
                    transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <path d="M -8 -2 L 7 -2 L 4 28 L -12 25 Z" fill="url(#iviPoloGrad)" />
                    <path d="M -9 24 L 3 24 L 6 62 L -6 62 Z" fill="#f7be9e" />
                    <g transform="translate(0, 58)">
                      <motion.g
                        animate={{ rotate: [-10, -4, -12, -5, -10] }}
                        transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        <path d="M -5 0 L 6 0 L 14 30 L 3 32 Z" fill="#f7be9e" />
                        <rect
                          x="-4"
                          y="22"
                          width="28"
                          height="36"
                          rx="4"
                          fill="#0f172a"
                          stroke="#94a3b8"
                          strokeWidth="1.5"
                        />
                        <rect x="-1" y="25" width="22" height="29" rx="2" fill="#e0f2fe" />
                        <rect x="2" y="29" width="14" height="3" rx="1.5" fill="#2563eb" />
                        <rect x="2" y="35" width="16" height="2.5" rx="1" fill="#64748b" />
                        <rect x="2" y="40" width="12" height="2.5" rx="1" fill="#64748b" />
                        <ellipse cx="14" cy="36" rx="4.5" ry="6" fill="#f7be9e" />
                      </motion.g>
                    </g>
                  </motion.g>
                </g>

                {/* TORSO + PROMINENT NAVY INVICTA POLO SHIRT */}
                <g transform="translate(0, 0)">
                  <path d="M -23 184 L 23 184 L 25 204 L -25 204 Z" fill="#475569" />
                  <rect x="-23" y="183" width="46" height="6" rx="2" fill="#334155" />
                  <rect x="-4" y="183" width="8" height="6" rx="1.5" fill="#cbd5e1" />

                  {/* Navy Invicta Polo Body */}
                  <path
                    d="M -28 104 C -30 99 -18 96 -10 96 L 10 96 C 18 96 30 99 28 104 L 24 185 L -24 185 Z"
                    fill="url(#iviPoloGrad)"
                  />
                  {/* Polo Collar & Placket with Gold Trim */}
                  <path d="M -12 96 L 0 113 L 12 96 L 7 92 L -7 92 Z" fill="#172c4a" stroke="#fbbf24" strokeWidth="0.9" />
                  <rect x="-2" y="111" width="4" height="19" rx="1.5" fill="#13253e" />
                  <circle cx="0" cy="117" r="1.3" fill="#e2e8f0" />
                  <circle cx="0" cy="124" r="1.3" fill="#e2e8f0" />

                  {/* Prominent Gold Invicta Shield Crest + Wordmark on Shirt */}
                  <g transform="translate(12, 126)">
                    <path
                      d="M 0 -8 L 8 -5 L 8 2 C 8 7 0 10.5 0 10.5 C 0 10.5 -8 7 -8 2 L -8 -5 Z"
                      fill="#f59e0b"
                      fillOpacity="0.28"
                      stroke="#fbbf24"
                      strokeWidth="1.5"
                    />
                    <text x="0" y="2.5" textAnchor="middle" fontSize="6.2" fontWeight="800" fill="#fde68a">
                      IN
                    </text>
                  </g>
                  <text
                    x="0"
                    y="153"
                    textAnchor="middle"
                    fontSize="8.5"
                    fontWeight="800"
                    letterSpacing="0.8"
                    fill="#fbbf24"
                  >
                    INVICTA
                  </text>
                </g>

                {/* RIGHT ARM GESTURING TOWARD CLASSROOM BOARD */}
                <g transform="translate(27, 106)">
                  <motion.g
                    animate={{ rotate: armRightUpperAngles }}
                    transition={{
                      duration: isSpeaking ? 4.2 : 6.0,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  >
                    <path d="M -7 -2 L 9 -2 L 13 26 L -3 28 Z" fill="url(#iviPoloGrad)" />
                    <path d="M -3 24 L 9 24 L 8 60 L -4 60 Z" fill="#f7be9e" />
                    <g transform="translate(2, 58)">
                      <motion.g
                        animate={{ rotate: armRightForeAngles }}
                        transition={{
                          duration: isSpeaking ? 3.2 : 4.8,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }}
                      >
                        <path d="M -5 0 L 6 0 L 8 36 L -3 36 Z" fill="#f7be9e" />
                        <g transform="translate(2, 36)">
                          <motion.g
                            animate={{ rotate: isSpeaking ? [-8, 12, -5, 10, -8] : [-3, 5, -3] }}
                            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                          >
                            <ellipse cx="1" cy="6" rx="5.5" ry="6.5" fill="#f7be9e" />
                            <rect x="2" y="6" width="3.5" height="12" rx="1.7" fill="#f7be9e" />
                            <rect x="-2" y="7" width="3.2" height="9.5" rx="1.5" fill="#f2b290" />
                          </motion.g>
                        </g>
                      </motion.g>
                    </g>
                  </motion.g>
                </g>

                {/* HEAD, BLINKING, LIP SYNC & HEADSET */}
                <g transform="translate(0, 94)">
                  <rect x="-7" y="-14" width="14" height="18" rx="5" fill="#f2b290" />
                  <motion.g
                    animate={{
                      rotate: isSpeaking ? [-1.8, 1.8, -1.2, 2.0, -1.8] : [-1.0, 1.0, -1.0],
                    }}
                    transition={{ duration: isSpeaking ? 4.4 : 6.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <path
                      d="M -29 -44 C -32 -18 -26 -2 -14 2 L 14 2 C 26 -2 32 -18 29 -44 C 26 -64 14 -72 0 -72 C -14 -72 -26 -64 -29 -44 Z"
                      fill="url(#iviHairGrad)"
                    />
                    <ellipse cx="-21" cy="-34" rx="4.2" ry="6.2" fill="#f2b290" />
                    <ellipse cx="21" cy="-34" rx="4.2" ry="6.2" fill="#f2b290" />
                    <path
                      d="M -20 -46 C -20 -60 20 -60 20 -46 L 20 -26 C 20 -10 10 -3 0 -3 C -10 -3 -20 -10 -20 -26 Z"
                      fill="#fbd1b7"
                    />
                    <ellipse cx="-11.5" cy="-24" rx="4.5" ry="2.6" fill="#f43f5e" fillOpacity="0.22" />
                    <ellipse cx="11.5" cy="-24" rx="4.5" ry="2.6" fill="#f43f5e" fillOpacity="0.22" />
                    <path d="M -13 -41 Q -8.5 -44 -4 -41" fill="none" stroke="#452717" strokeWidth="1.9" strokeLinecap="round" />
                    <path d="M 4 -41 Q 8.5 -44 13 -41" fill="none" stroke="#452717" strokeWidth="1.9" strokeLinecap="round" />

                    <motion.g
                      animate={{ scaleY: [1, 1, 0.1, 1, 1] }}
                      transition={{ duration: 4.6, repeat: Infinity, times: [0, 0.9, 0.94, 0.98, 1] }}
                    >
                      <ellipse cx="-8.5" cy="-34" rx="2.7" ry="3.2" fill="#1e293b" />
                      <circle cx="-9.3" cy="-35.2" r="0.9" fill="#ffffff" />
                      <ellipse cx="8.5" cy="-34" rx="2.7" ry="3.2" fill="#1e293b" />
                      <circle cx="7.7" cy="-35.2" r="0.9" fill="#ffffff" />
                    </motion.g>

                    <path d="M 0 -33 L -1.5 -25 L 1.5 -24" fill="none" stroke="#d99a78" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

                    {isSpeaking ? (
                      <motion.ellipse
                        cx="0"
                        cy="-14.5"
                        rx="5.2"
                        fill="#9f1239"
                        stroke="#ffffff"
                        strokeWidth="0.9"
                        animate={{ ry: [1.6, 4.2, 2.2, 4.6, 1.8] }}
                        transition={{ duration: 0.48, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    ) : (
                      <path
                        d="M -6.5 -16 Q 0 -10.5 6.5 -16"
                        fill="none"
                        stroke="#9f1239"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                      />
                    )}

                    <path
                      d="M -22 -42 C -21 -62 -5 -70 7 -68 C 19 -66 24 -52 22 -38 C 17 -48 9 -54 0 -55 C -7 -47 -15 -42 -22 -42 Z"
                      fill="url(#iviHairGrad)"
                    />

                    <path d="M -21 -38 C -23 -62 23 -62 21 -38" fill="none" stroke="#475569" strokeWidth="2.8" />
                    <rect x="18" y="-42" width="6.5" height="13" rx="3" fill="#334155" stroke="#94a3b8" strokeWidth="1" />
                    <path d="M 21 -31 Q 18 -16 4 -14" fill="none" stroke="#334155" strokeWidth="1.8" strokeLinecap="round" />
                    <ellipse cx="4" cy="-14" rx="2.4" ry="1.8" fill="#0f172a" />
                  </motion.g>
                </g>
              </g>
            </motion.g>
          </svg>
        </div>

        {/* Bottom Caption & Voice Bar (Quietly Below Scene) */}
        <div className="px-3 py-2 bg-slate-900 text-white flex items-center justify-between gap-2 text-[11px] border-t border-slate-700 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Volume2 className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="font-semibold truncate">
              {fieldLabel ? `No Quadro: ${fieldLabel}` : `Instrutora Ivi · Invicta`}
            </span>
          </div>
          <select
            value={selectedVoice}
            onChange={(e) => onChangeVoice(e.target.value as 'Aoede' | 'Kore' | 'Zephyr')}
            aria-label="Voz da Ivi no Gemini"
            className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-100 shrink-0"
          >
            <option value="Aoede">Aoede</option>
            <option value="Kore">Kore</option>
            <option value="Zephyr">Zephyr</option>
          </select>
        </div>
      </div>
    </div>
  );
};
