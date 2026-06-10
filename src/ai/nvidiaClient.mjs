const MODEL_PRESETS = [
  {
    id: "nvidia/nemotron-3-super-120b-a12b",
    label: "Nemotron 3 Super 120B",
    role: "orchestrator",
    temperature: 0.35,
    top_p: 0.9
  },
  {
    id: "deepseek-ai/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    role: "reasoning",
    temperature: 0.35,
    top_p: 0.9
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    role: "general",
    temperature: 0.3,
    top_p: 0.9
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    role: "fast",
    temperature: 0.25,
    top_p: 0.85
  }
];

export function selectAgentModel(config, role = "orchestrator") {
  const envDefault = MODEL_PRESETS.find((model) => model.id === config.nvidiaDefaultModel);
  if (envDefault && role === "orchestrator") {
    return envDefault;
  }
  return MODEL_PRESETS.find((model) => model.role === role) || envDefault || MODEL_PRESETS[0];
}

export async function callNvidiaChat({ config, model, messages, maxTokens = 900 }) {
  if (config.disableNvidia || !config.nvidiaApiKey) {
    throw new Error("NVIDIA_API_KEY is not configured.");
  }

  const payload = {
    model: model.id,
    messages,
    max_tokens: maxTokens,
    temperature: model.temperature,
    top_p: model.top_p,
    stream: false
  };

  const upstream = await fetch(config.nvidiaEndpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.nvidiaApiKey}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    signal: AbortSignal.timeout(config.nvidiaTimeoutMs),
    body: JSON.stringify(payload)
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`NVIDIA API returned ${upstream.status}: ${text.slice(0, 300)}`);
  }

  const json = JSON.parse(text);
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("NVIDIA response did not include assistant content.");
  }

  return {
    content,
    model: model.id,
    usage: json.usage || null
  };
}
