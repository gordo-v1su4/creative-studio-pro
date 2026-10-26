/** Still presets shared by Prep, approval cards and the Higgsfield adapter. */
export const IMAGE_MODEL_IDS = ['gpt_image_2_5', 'nano_banana_pro'] as const;
export type ImageModelId = typeof IMAGE_MODEL_IDS[number];
export const IMAGE_MODELS = {
	gpt_image_2_5: { job_type: 'gpt_image_2_5', label: 'GPT Image 2.5 Sunburst', variant: 'sunburst', quality: 'high', resolution: '2k' },
	nano_banana_pro: { job_type: 'nano_banana_pro', label: 'Nano Banana Pro', resolution: '2k' }
} as const;
