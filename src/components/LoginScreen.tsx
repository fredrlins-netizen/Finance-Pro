import React, { useEffect, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import {
  Building2,
  Car,
  CheckCircle2,
  FileText,
  KeyRound,
  Landmark,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiFetch, setAuthToken } from '../lib/api.ts';
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

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated, branding }) => {
  const [email, setEmail] = useState('admin@financepro.com.br');
  const [password, setPassword] = useState('Invicta@2026');
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
      const data = (await res.json()) as CaptchaData;
      setCaptcha(data);
      setSelectedTiles([]);
      setMathAnswer('');
    } catch {
      setError('Falha ao carregar desafio de segurança.');
    }
  };

  useEffect(() => {
    loadCaptcha();
    if (!branding) {
      fetch('/api/public/portal-branding')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { branding?: PortalBrandingConfig } | null) => {
          if (d?.branding) setFetchedBranding(d.branding);
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

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      setAuthToken(idToken);
      onAuthenticated(idToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login Google.');
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
      const res = await apiFetch<{ message: string; demoTempPasswordPreview?: string }>(
        '/api/auth/forgot-password',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        }
      );
      setForgotInfo(
        `${res.message}${res.demoTempPasswordPreview ? ` (Senha temporária gerada para teste: ${res.demoTempPasswordPreview})` : ''}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao solicitar senha temporária.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-6 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {/* Left Brand & Architecture Panel */}
        <div className="lg:col-span-5 bg-slate-900 text-slate-100 p-6 sm:p-8 flex flex-col justify-between">
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
                <span className="font-display text-lg font-bold tracking-tight text-white truncate">
                  {brandName}
                </span>
              </div>
              <PWAInstallButton />
            </div>

            <h1 className="mt-8 font-display text-2xl font-bold tracking-tight text-white leading-snug">
              {brandHeadline}
            </h1>
            <p className="mt-3 text-sm text-slate-300 leading-relaxed">
              {brandDescription}
            </p>
          </div>

          <div className="mt-8 space-y-3 border-t border-slate-800 pt-6 text-xs text-slate-300">
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
              <span>Acesso de Demonstração: admin@financepro.com.br / Invicta@2026</span>
            </div>
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="lg:col-span-7 p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900">
                {forgotMode ? 'Recuperação de Acesso' : 'Acesso Corporativo'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {forgotMode
                  ? 'Enviaremos uma senha temporária para seu e-mail e notificaremos o administrador.'
                  : 'Informe suas credenciais e resolva os dois desafios de verificação.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setForgotMode(!forgotMode);
                setError('');
                setForgotInfo('');
              }}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
            >
              {forgotMode ? 'Voltar ao login' : 'Esqueci a senha'}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          {forgotInfo && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
              {forgotInfo}
            </div>
          )}

          {forgotMode ? (
            <form onSubmit={handleForgotPassword} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  E-mail cadastrado do colaborador
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="colaborador@financepro.com.br"
                    className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-slate-900 py-2.5 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 min-h-[44px]"
              >
                {loading ? 'Enviando...' : 'Gerar Senha Temporária e Notificar Admin'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleCorporateLogin} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    E-mail cadastrado
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Senha
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none min-h-[42px]"
                  />
                </div>
              </div>

              {/* Dual CAPTCHA Block */}
              {captcha && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      1º CAPTCHA Matemático · 2º CAPTCHA Visual
                    </span>
                    <button
                      type="button"
                      onClick={loadCaptcha}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Atualizar
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm font-semibold text-slate-900 shrink-0">
                      {captcha.mathQuestion}
                    </div>
                    <input
                      type="number"
                      required
                      value={mathAnswer}
                      onChange={(e) => setMathAnswer(e.target.value)}
                      placeholder="Resultado numérico"
                      className="w-full sm:w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-blue-600 focus:outline-none min-h-[40px]"
                    />
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-700 mb-2">
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
                                ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
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

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-lg bg-emerald-600 py-2.5 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 min-h-[44px] transition-colors"
                >
                  {loading ? 'Validando...' : 'Entrar no Sistema'}
                </button>
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="rounded-lg border border-slate-300 bg-white py-2.5 px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 min-h-[44px] whitespace-nowrap transition-colors"
                >
                  Entrar com Google
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
