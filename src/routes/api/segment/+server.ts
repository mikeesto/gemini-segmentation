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
const MASK_THRESHOLD = '50%';

export async function POST({ request }) {
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
		const tempDir = '/tmp';
		const timestamp = Date.now();

		const tempInputPath = path.join(tempDir, `input_${timestamp}.png`);
		await fs.writeFile(tempInputPath, Buffer.from(arrayBuffer));

		// Resize input image
		const tempResizedPath = path.join(tempDir, `resized_${timestamp}.png`);
		await execPromise(
			`convert "${tempInputPath}" -resize ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT} -quality ${OUTPUT_QUALITY} "${tempResizedPath}"`
		);

		// Get image dimensions
		const { stdout: sizeInfo } = await execPromise(`identify -format "%wx%h" "${tempResizedPath}"`);
		const [imageWidth, imageHeight] = sizeInfo.split('x').map(Number);

		// 3. Call AI for segmentation
		const ai = new GoogleGenAI({ apiKey: env.GOOGLE_API_KEY });
		const prompt = 'Give the segmentation masks for the pelican...';

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
		const regex =
			/"box_2d"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]\s*,\s*"mask"\s*:\s*"(data:image\/[^;]+;base64,[^"]+)"/;
		const match = responseText.match(regex);

		if (!match) throw new Error('Could not extract mask from AI response');

		// 5. Convert coordinates
		const [yMin, xMin, yMax, xMax] = match
			.slice(1, 5)
			.map((val, i) =>
				Math.max(
					0,
					Math.min(
						Math.round((parseInt(val, 10) / 1000) * (i % 2 ? imageWidth : imageHeight)),
						(i % 2 ? imageWidth : imageHeight) - 1
					)
				)
			);

		const boxWidth = Math.min(xMax - xMin, imageWidth - xMin);
		const boxHeight = Math.min(yMax - yMin, imageHeight - yMin);

		// 6. Process mask with ImageMagick
		const maskBase64 = match[5].split(',')[1];
		const tempMaskPath = path.join(tempDir, `mask_${timestamp}.png`);
		await fs.writeFile(tempMaskPath, Buffer.from(maskBase64, 'base64'));

		// Process mask - resize and threshold (don't invert yet)
		const tempProcessedMaskPath = path.join(tempDir, `processed_mask_${timestamp}.png`);
		await execPromise(
			`convert "${tempMaskPath}" ` +
				`-resize ${boxWidth}x${boxHeight}! ` +
				`-threshold ${MASK_THRESHOLD} ` +
				`-alpha off -colorspace Gray ` +
				`"${tempProcessedMaskPath}"`
		);

		// 7. Create full-size alpha mask (INVERTED - white where plant is)
		const tempFullMaskPath = path.join(tempDir, `full_mask_${timestamp}.png`);
		console.log(
			`Creating full mask: ${imageWidth}x${imageHeight}, drawing processed mask at +${xMin}+${yMin}`
		);
		await execPromise(
			`convert -size ${imageWidth}x${imageHeight} xc:black ` + // Start with black (transparent for CopyOpacity)
				`-draw "image Over ${xMin},${yMin} 0,0 '${tempProcessedMaskPath}'" ` + // Draw the small white mask onto black bg
				// `-gravity NorthWest -draw "image Over ${xMin},${yMin} 0,0 '${tempProcessedMaskPath}'" ` + // Alternative drawing
				`"${tempFullMaskPath}"`
		);
		// tempFiles.push(tempFullMaskPath);

		// 8. Apply mask to original image to extract plant
		const tempOutputPath = path.join(tempDir, `output_${timestamp}.png`);
		console.log(`Applying mask and cropping to: ${boxWidth}x${boxHeight}+${xMin}+${yMin}`);
		await execPromise(
			`convert "${tempResizedPath}" "${tempFullMaskPath}" ` + // Original image and the CORRECT full mask
				`-alpha off -compose CopyOpacity -composite ` + // Apply mask (makes bg transparent)
				`-crop ${boxWidth}x${boxHeight}+${xMin}+${yMin} ` + // CROP to the bounding box
				`+repage ` + // Reset canvas offset after crop
				`"${tempOutputPath}"` // Save the final cropped PNG
		);

		// Read final image
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
