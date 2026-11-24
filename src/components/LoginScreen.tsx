import React, { useEffect, useState } from 'react';
import {
  Building2,
  Car,
  CheckCircle2,
  FileText,
  KeyRound,
  Landmark,
  Lock,
  Mail,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { apiFetch, parseJsonResponse, setAuthToken } from '../lib/api.ts';
import { setCachedPortalBranding } from '../lib/portalBrandingCache.ts';
import { useTheme } from '../lib/theme.tsx';
import { AuthUser, PortalBrandingConfig } from '../types.ts';
import { PWAInstallButton } from './PWAControls.tsx';

interface CaptchaTile {
  id: string;
  category: string;
  label: string;
}

interface CaptchaData {
  token: string;
  mathQuestion: string;
  imagePrompt: string;
  tiles: CaptchaTile[];
}

interface LoginScreenProps {
  onAuthenticated: (token: string, user?: AuthUser) => void;
  branding?: PortalBrandingConfig | null;
  forcedLockMessage?: string;
}

function renderTileIcon(category: string) {
  switch (category) {
    case 'veiculo':
      return <Car className="w-5 h-5" />;
    case 'contrato':
      return <FileText className="w-5 h-5" />;
    case 'seguranca':
      return <Lock className="w-5 h-5" />;
    default:
      return <Landmark className="w-5 h-5" />;
  }
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onAuthenticated,
  branding,
  forcedLockMessage,
}) => {
  const { isDark, toggleTheme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mathAnswer, setMathAnswer] = useState('');
  const [selectedTiles, setSelectedTiles] = useState<string[]>([]);
  const [captcha, setCaptcha] = useState<CaptchaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotInfo, setForgotInfo] = useState('');
  const [fetchedBranding, setFetchedBranding] = useState<PortalBrandingConfig | null>(null);

  const loadCaptcha = async () => {
    try {
      const res = await fetch('/api/auth/captcha');
      const data = await parseJsonResponse<CaptchaData>(res, 'Falha ao carregar desafio de segurança.');
      setCaptcha(data);
      setSelectedTiles([]);
      setMathAnswer('');
    } catch {
      setError('Falha ao carregar desafio de segurança.');
    }
  };

  useEffect(() => {
    loadCaptcha();
    if (branding) {
      setCachedPortalBranding(branding);
    } else {
      fetch('/api/public/portal-branding')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { branding?: PortalBrandingConfig } | null) => {
          if (d?.branding) {
            setFetchedBranding(d.branding);
            setCachedPortalBranding(d.branding);
          }
        })
        .catch(() => {});
    }
  }, [branding]);

  const activeBranding = branding || fetchedBranding;
  const brandName = activeBranding?.companyName?.trim() || 'FinancePro Assessoria';
  const brandHeadline =
    activeBranding?.marketingHeadline?.trim() ||
    'Gestão Integrada de Passivos, Jurídico e Cobrança';
  const brandDescription =
    activeBranding?.marketingDescription?.trim() ||
    'Operação multi-unidade (Matriz, Salvador, Fortaleza, Maceió, João Pessoa, São Paulo e Natal) com controle de horários, cofre documental de 60GB+ e IA Ivi em cadeia multi-provedor.';

  const toggleTile = (id: string) => {
    setSelectedTiles((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleCorporateLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captcha) return;
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          captchaToken: captcha.token,
          mathAnswer,
          selectedTiles,
        }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao autenticar.');
      loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setForgotInfo('');
    setLoading(true);
    try {
      const res = await apiFetch<{ message: string }>(
        '/api/auth/forgot-password',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        }
      );
      setForgotInfo(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao solicitar senha temporária.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen fp-canvas flex flex-col justify-center py-6 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        {/* Left Brand & Architecture Panel */}
        <div className="lg:col-span-5 fp-login-left lg:border-r p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {activeBranding?.logoDataUrl ? (
                  <img
                    src={activeBranding.logoDataUrl}
                    alt={brandName}
                    referrerPolicy="no-referrer"
                    className="h-9 w-9 rounded-lg object-contain bg-white/10 p-1 shrink-0"
                  />
                ) : (
                  <div className="h-9 w-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                )}
                <span className="font-display text-lg font-bold tracking-tight fp-login-left-text truncate">
                  {brandName}
                </span>
              </div>
              <PWAInstallButton />
            </div>

            <h1 className="mt-8 font-display text-2xl font-bold tracking-tight fp-login-left-text leading-snug">
              {brandHeadline}
            </h1>
            <p className="mt-3 text-sm fp-login-left-muted leading-relaxed">
              {brandDescription}
            </p>
          </div>

          <div className="mt-8 space-y-3 border-t border-white/15 pt-6 text-xs fp-login-left-muted">
            <div className="flex items-center gap-2.5">
              <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>7 Unidades · Validação de Custo Mínimo e Turnos</span>
            </div>
            <div className="flex items-center gap-2.5">
              <KeyRound className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Dupla Verificação CAPTCHA + Alerta WhatsApp ao Admin</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Proteção LGPD · Desconexão automática por inatividade (3h)</span>
            </div>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="lg:col-span-7 fp-login-right p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 dark:border-slate-800 pb-4">
            <div>
              <h2 className="font-display text-xl font-bold fp-login-right-text">
                {forgotMode ? 'Recuperação de Acesso' : 'Acesso Corporativo'}
              </h2>
              <p className="text-xs fp-login-right-muted mt-0.5">
                {forgotMode
                  ? 'Enviaremos uma senha temporária para seu e-mail e notificaremos o administrador.'
                  : 'Informe suas credenciais e resolva os dois desafios de verificação.'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={toggleTheme}
                title={isDark ? 'Alternar para Modo Claro (White)' : 'Alternar para Modo Escuro (Dark)'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                {isDark ? (
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <Moon className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                )}
                <span>{isDark ? 'Claro' : 'Escuro'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setForgotMode(!forgotMode);
                  setError('');
                  setForgotInfo('');
                }}
                className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 whitespace-nowrap"
              >
                {forgotMode ? 'Voltar ao login' : 'Esqueci a senha'}
              </button>
            </div>
          </div>

          {(error || forcedLockMessage) && (() => {
            const displayErr = error || forcedLockMessage || '';
            const isSuspendedErr = /suspens|3 tentativas|reabilita/i.test(displayErr);
            return (
              <div
                className={`mt-4 rounded-xl border px-3.5 py-3 text-xs space-y-1 ${
                  isSuspendedErr
                    ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/70 text-red-800 dark:text-red-200'
                    : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300'
                }`}
              >
                <div className="font-bold flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>{isSuspendedErr ? 'Acesso Bloqueado / Usuário Suspenso' : 'Aviso de Autenticação'}</span>
                </div>
                <div className="font-medium leading-relaxed">{displayErr}</div>
              </div>
            );
          })()}

          {forgotInfo && (
            <div className="mt-4 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3.5 py-2.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
              {forgotInfo}
            </div>
          )}

          {forgotMode ? (
            <form onSubmit={handleForgotPassword} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold fp-login-right-text mb-1.5">
                  E-mail cadastrado do colaborador
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3 dark:text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="colaborador@financepro.com.br"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg fp-primary-btn py-2.5 px-4 text-sm font-semibold disabled:opacity-50 min-h-[44px] transition-colors"
              >
                {loading ? 'Enviando...' : 'Gerar Senha Temporária e Notificar Admin'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleCorporateLogin} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold fp-login-right-text mb-1">
                    E-mail cadastrado
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold fp-login-right-text mb-1">
                    Senha
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none min-h-[42px]"
                  />
                </div>
              </div>

              {/* Dual CAPTCHA Block */}
              {captcha && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      1º CAPTCHA Matemático · 2º CAPTCHA Visual
                    </span>
                    <button
                      type="button"
                      onClick={loadCaptcha}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Atualizar
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3.5 py-2 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                      {captcha.mathQuestion}
                    </div>
                    <input
                      type="number"
                      required
                      value={mathAnswer}
                      onChange={(e) => setMathAnswer(e.target.value)}
                      placeholder="Resultado numérico"
                      className="w-full sm:w-48 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-blue-600 focus:outline-none min-h-[40px]"
                    />
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
                      {captcha.imagePrompt}
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {captcha.tiles.map((tile) => {
                        const selected = selectedTiles.includes(tile.id);
                        return (
                          <button
                            key={tile.id}
                            type="button"
                            onClick={() => toggleTile(tile.id)}
                            className={`flex flex-col items-center justify-center gap-1 rounded-lg border p-2.5 text-center transition-colors min-h-[68px] ${
                              selected
                                ? 'border-emerald-600 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                          >
                            {renderTileIcon(tile.category)}
                            <span className="text-[11px] font-medium leading-tight">
                              {tile.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg fp-primary-btn py-2.5 px-4 text-sm font-semibold disabled:opacity-50 min-h-[44px] transition-colors"
                >
                  {loading ? 'Validando...' : 'Entrar no Sistema'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
