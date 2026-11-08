import { useLingui } from "@lingui/react/macro";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AccountMenu } from "../components/AccountMenu";
import { PageLoading } from "../components/PageLoading";
import { SignupSurvey } from "../components/SignupSurvey";
import type { ModelCatalogEntry } from "../lib/model-auth";
import { rpc } from "../lib/rpc";
import { useSignOut } from "../lib/sign-out";
import { errorText } from "../lib/user-error";
import { ensureFirstBot, FirstBotRetry } from "./onboarding/first-bot";
import { ModelStep } from "./onboarding/model-step";
import { useOnboardingModel } from "./onboarding/use-onboarding-model";

export function OnboardingPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fieldId = useId();
  // The URL holds the survey and model steps, so /onboarding/survey and /onboarding/model open
  // directly. The model step still yields once me says the deployment already has a model.
  const { step: routeStep } = useParams();
  const linkedStep = routeStep === "survey" || routeStep === "model" ? routeStep : undefined;
  const [creatingBot, setCreatingBot] = useState(false);
  const [surveyDone, setSurveyDone] = useState(false);
  const step = creatingBot ? "bot" : surveyDone ? "loading" : (linkedStep ?? "loading");
  const [billingEnabled, setBillingEnabled] = useState(false);
  // The step after the survey; null until me loads.
  const [afterSurvey, setAfterSurvey] = useState<"model" | "bot" | null>(null);
  // /onboarding/model renders from the URL alone. Wait for me before showing it, so a
  // deployment that already has a model never paints the connect form.
  const [accountReady, setAccountReady] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const model = useOnboardingModel({
    catalog,
    billingEnabled,
    onConnected: () => goTo("bot"),
  });
  const { error, modelProbe, setError } = model;
  const createStartedRef = useRef(false);
  const { signingOut, logOut } = useSignOut("/sign-in", setError);

  useEffect(() => {
    void Promise.all([rpc.me(), rpc.models.list().catch(() => [])])
      .then(([me, models]) => {
        setBillingEnabled(me.billingEnabled);
        setCatalog(models);
        const next = me.needsModel ? "model" : "bot";
        setAfterSurvey(next);
        setAccountReady(true);
        // A direct survey link stays put. A direct model link stays only while a model
        // is still required; a configured deployment default, including a keyless local
        // model, leaves that page instead of asking for an API key.
        if (me.needsSignupSurvey && linkedStep === "survey") return;
        if (me.needsSignupSurvey && !(linkedStep === "model" && me.needsModel)) {
          goTo("survey");
          return;
        }
        if (!me.needsModel) {
          goTo("bot");
          return;
        }
        if (!linkedStep) goTo("model");
      })
      .catch(() => {
        setAfterSurvey("bot");
        setAccountReady(true);
        if (!linkedStep) goTo("bot");
      });
    return () => {
      modelProbe.invalidate();
    };
  }, []);

  useEffect(() => {
    if (!surveyDone || !afterSurvey) return;
    setSurveyDone(false);
    goTo(afterSurvey);
  }, [surveyDone, afterSurvey]);

  function goTo(next: "survey" | "model" | "bot") {
    if (next === "bot") setCreatingBot(true);
    navigate(next === "bot" ? "/onboarding" : `/onboarding/${next}`, { replace: true });
  }

  async function createFirstBot() {
    if (createStartedRef.current) return;
    createStartedRef.current = true;
    setError(null);
    try {
      const bot = await ensureFirstBot();
      // Onboarding continues conversationally in the thread: greeting first,
      // then the focus choice (immediate for the first bot).
      const started = await rpc.onboarding
        .start({ botId: bot.id })
        .then(() => true)
        .catch(() => false);
      if (started) {
        await rpc.onboarding.promptFocus({ botId: bot.id }).catch(() => undefined);
      }
      navigate(`/app/${bot.id}`);
    } catch (err) {
      createStartedRef.current = false;
      setError(errorText(err, t`Could not create your bot`));
    }
  }

  useEffect(() => {
    if (step !== "bot") return;
    void createFirstBot();
  }, [step]);

  // Loading, and creating the first bot, both wait on one spinner until the chat opens.
  // The model URL is not that step until me says a model is still required.
  if ((linkedStep === "model" && !accountReady) || step === "loading" || (step === "bot" && !error))
    return <PageLoading />;

  return (
    <div className="min-h-full bg-background px-6 py-12" data-rakazo-surface="onboarding">
      <AccountMenu signingOut={signingOut} onLogOut={() => void logOut()} />
      <div className="mx-auto w-full max-w-[560px]">
        {step === "survey" ? <SignupSurvey onDone={() => setSurveyDone(true)} /> : null}
        {step === "model" ? <ModelStep model={model} fieldId={fieldId} /> : null}
        {step === "bot" ? (
          <FirstBotRetry error={error} onRetry={() => void createFirstBot()} />
        ) : null}
      </div>
    </div>
  );
}
