import { exec } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI } from '@google/genai';
import { env } from '$env/dynamic/private';
import fs from 'fs/promises';
import path from 'path';

const execPromise = promisify(exec);
const MAX_IMAGE_WIDTH = 1024;
const MAX_IMAGE_HEIGHT = 1024;
const OUTPUT_QUALITY = 80;
const MASK_THRESHOLD = '50%'; // White >= 50%, Black < 50%

export async function POST({ request }) {
	const tempDir = '/tmp';
	const timestamp = Date.now();

	try {
		// 1. Handle file upload
		const formData = await request.formData();
		const file = formData.get('file');

		if (!file) {
			return new Response(JSON.stringify({ error: 'No file uploaded' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// 2. Process input image
		const arrayBuffer = await file.arrayBuffer();
		const inputFilename = `input_${timestamp}.${file.name.split('.').pop() || 'png'}`;
		const tempInputPath = path.join(tempDir, inputFilename);
		await fs.writeFile(tempInputPath, Buffer.from(arrayBuffer));

		// Resize input image
		const tempResizedPath = path.join(tempDir, `resized_${timestamp}.png`);
		await execPromise(
			`convert "${tempInputPath}" -resize ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT} -quality ${OUTPUT_QUALITY} "${tempResizedPath}"`
		);

		// Get image dimensions after resizing
		const { stdout: sizeInfo } = await execPromise(`identify -format "%wx%h" "${tempResizedPath}"`);
		const [imageWidth, imageHeight] = sizeInfo.split('x').map(Number);

		// 3. Make API call to Gemini
		const ai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });
		const prompt =
			'Give the segmentation mask for the pelican. Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", and the segmentation mask in key "mask".';

		const base64Image = (await fs.readFile(tempResizedPath)).toString('base64');
		const response = await ai.models.generateContent({
			model: 'gemini-2.5-flash-preview-04-17',
			contents: [
				prompt,
				{
					inlineData: {
						data: base64Image,
						mimeType: 'image/png'
					}
				}
			]
		});

		// 4. Parse AI response
		const responseText = response.text;
		let match;
		try {
			const cleanedText = responseText.replace(/^```json\s*|```$/g, '').trim();
			const parsedJson = JSON.parse(cleanedText);
			const firstItem = Array.isArray(parsedJson) ? parsedJson[0] : parsedJson;
			if (firstItem && firstItem.box_2d && firstItem.mask) {
				match = [
					null, // Placeholder for full match string
					...firstItem.box_2d, // yMin, xMin, yMax, xMax
					firstItem.mask // data:image/png;base64,...
				];
			}
		} catch (jsonError) {
			console.warn('Could not parse AI response as JSON, falling back to regex:', jsonError);
			const regex =
				/"box_2d"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\][\s\S]*?"mask"\s*:\s*"(data:image\/png;base64,[^"]+)"/i;
			match = responseText.match(regex);
		}

		if (!match || match.length < 6) {
			console.error('AI Response Text:', responseText);
			throw new Error('Could not extract coordinates and mask from AI response');
		}

		// 5. Convert coordinates (Normalized 0-1000 to Pixel values)
		const normYMin = parseInt(match[1], 10);
		const normXMin = parseInt(match[2], 10);
		const normYMax = parseInt(match[3], 10);
		const normXMax = parseInt(match[4], 10);

		const clamp = (val) => Math.max(0, Math.min(1000, val));

		const yMin = Math.max(0, Math.round((clamp(normYMin) / 1000) * imageHeight));
		const xMin = Math.max(0, Math.round((clamp(normXMin) / 1000) * imageWidth));
		const yMax = Math.min(imageHeight, Math.round((clamp(normYMax) / 1000) * imageHeight));
		const xMax = Math.min(imageWidth, Math.round((clamp(normXMax) / 1000) * imageWidth));

		const boxWidth = Math.max(1, xMax - xMin);
		const boxHeight = Math.max(1, yMax - yMin);

		// 6. Process mask data from Gemini response
		const maskDataUrl = match[5];
		if (!maskDataUrl.startsWith('data:image/png;base64,')) {
			throw new Error('Mask data is not a valid PNG base64 Data URL');
		}
		const maskBase64 = maskDataUrl.split(',')[1];
		const tempMaskPath = path.join(tempDir, `mask_${timestamp}.png`);
		await fs.writeFile(tempMaskPath, Buffer.from(maskBase64, 'base64'));

		// Process the raw mask: Resize to bounding box, threshold (White = Object), make grayscale
		const tempProcessedMaskPath = path.join(tempDir, `processed_mask_${timestamp}.png`);
		await execPromise(
			`convert "${tempMaskPath}" ` +
				`-resize ${boxWidth}x${boxHeight}! ` +
				`-threshold ${MASK_THRESHOLD} ` +
				`-alpha off -colorspace Gray ` +
				`"${tempProcessedMaskPath}"`
		);

		// 7. Create a full-size alpha mask: Black background, place white processed mask at offset
		const tempFullMaskPath = path.join(tempDir, `full_mask_${timestamp}.png`);
		await execPromise(
			`convert -size ${imageWidth}x${imageHeight} xc:black ` + // Start with black (transparent for CopyOpacity)
				`-draw "image Over ${xMin},${yMin} 0,0 '${tempProcessedMaskPath}'" ` + // Draw the small white mask onto black bg
				`"${tempFullMaskPath}"`
		);

		// 8. Apply the full mask to the original image using CopyOpacity, then crop to the bounding box
		const tempOutputPath = path.join(tempDir, `output_${timestamp}.png`);
		await execPromise(
			`convert "${tempResizedPath}" "${tempFullMaskPath}" ` + // Original image and the full mask
				`-alpha off -compose CopyOpacity -composite ` + // Apply mask (makes bg transparent)
				`-crop ${boxWidth}x${boxHeight}+${xMin}+${yMin} ` + // CROP to the bounding box
				`+repage ` + // Reset canvas offset after crop
				`"${tempOutputPath}"` // Save the final cropped PNG
		);

		// 9. Read final image
		const finalImage = await fs.readFile(tempOutputPath);

		// Clean up temp files
		await Promise.all(
			[
				fs.unlink(tempInputPath),
				fs.unlink(tempResizedPath),
				fs.unlink(tempMaskPath),
				fs.unlink(tempProcessedMaskPath),
				fs.unlink(tempFullMaskPath),
				fs.unlink(tempOutputPath)
			].map((p) => p.catch((e) => console.warn('Error deleting temp file:', e)))
		);

		return new Response(finalImage, {
			status: 200,
			headers: {
				'Content-Type': 'image/png',
				'Content-Length': finalImage.length.toString()
			}
		});
	} catch (error) {
		console.error('Error processing image:', error);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}
