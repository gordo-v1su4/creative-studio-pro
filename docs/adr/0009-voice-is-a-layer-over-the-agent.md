# Voice is a layer over the Agent, not a second Agent

The operator can talk to the Agent and hear it answer. OpenAI's voice API only turns speech into text and text into speech; every reply is still reasoned by the project's model provider, with the same skills and production rules as typed chat. We chose this over letting a realtime voice model answer directly, which would have been quicker to respond but would have given voice a different brain: prompts and specs written by voice would not follow the ONE SHOT skills, and a project could behave one way spoken and another way typed.

**Consequences**: a spoken turn is slower than a native voice model's, because it waits for the model provider; voice works with any model provider, including the Raycast bridge; the OpenAI key is one more documented secret and voice is simply absent when it is not set; what was said is kept as ordinary chat text, so a spoken session can be read back and resumed by typing.
