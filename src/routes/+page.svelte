<script lang="ts">
	let selectedFile: File | null = $state(null);
	let finalImageSrc: string | null = $state(null);
	let segmentTarget: string = $state('');
	let isLoading: boolean = $state(false);
	let previewUrl: string | null = $state(null);

	function handleFileInput(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			selectedFile = input.files[0];
			previewUrl = URL.createObjectURL(input.files[0]);
		}
	}

	async function handleSubmit() {
		if (!selectedFile || !segmentTarget.trim()) {
			alert('Please select a file and specify what to segment.');
			return;
		}

		isLoading = true;
		const formData = new FormData();
		formData.append('file', selectedFile);
		formData.append('target', segmentTarget);

		try {
			const response = await fetch('/api/segment', {
				method: 'POST',
				body: formData
			});

			const image = await response.blob();
			finalImageSrc = URL.createObjectURL(image);
		} catch (error) {
			console.error('Error uploading file:', error);
			alert('An error occurred while processing the image.');
		} finally {
			isLoading = false;
		}
	}

	function downloadImage() {
		if (finalImageSrc) {
			const a = document.createElement('a');
			a.href = finalImageSrc;
			a.download = `segmented-${segmentTarget}-${Date.now()}.png`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
		}
	}
</script>

<div class="min-h-screen bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
	<div class="mx-auto max-w-3xl">
		<div class="mb-12 text-center">
			<h1 class="mb-2 text-4xl font-bold text-gray-900">Gemini Segment</h1>
			<p class="text-lg text-gray-600">Extract an object from an image using a LLM</p>
		</div>

		<div class="space-y-6 rounded-xl bg-white p-6 shadow-lg">
			<div class="space-y-4">
				<label for="file-input" class="block text-sm font-medium text-gray-700"
					>Upload your image</label
				>
				<input
					id="file-input"
					type="file"
					accept="image/*"
					oninput={handleFileInput}
					class="block w-full text-sm text-gray-500 file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
				/>

				{#if previewUrl}
					<div class="mt-4">
						<img src={previewUrl} alt="Preview" class="mx-auto max-h-64 rounded-lg shadow-sm" />
					</div>
				{/if}

				<div class="mt-4">
					<label for="target" class="mb-1 block text-sm font-medium text-gray-700"
						>What would you like to segment (one object only)?</label
					>
					<input
						type="text"
						id="target"
						bind:value={segmentTarget}
						placeholder="e.g., person, car, dog..."
						class="w-full rounded-md border border-gray-300 px-4 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500"
					/>
				</div>

				<button
					onclick={handleSubmit}
					disabled={isLoading || !selectedFile || !segmentTarget}
					class="flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-400"
				>
					{#if isLoading}
						<svg class="mr-3 -ml-1 h-5 w-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							></circle>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							></path>
						</svg>
						Processing...
					{:else}
						Segment Image
					{/if}
				</button>
			</div>

			{#if finalImageSrc}
				<div class="mt-8 border-t pt-6">
					<div class="mb-4 flex items-center justify-between">
						<h2 class="text-xl font-semibold text-gray-900">Segmentation Result</h2>
						<button
							onclick={downloadImage}
							class="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:outline-none"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="mr-2 h-5 w-5"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
								/>
							</svg>
							Download
						</button>
					</div>
					<div class="rounded-lg p-4">
						<img
							src={finalImageSrc}
							alt="Segmented Result"
							class="mx-auto max-w-full rounded-lg shadow-lg"
						/>
					</div>
				</div>
			{/if}

			<p class="mt-4 text-center text-sm text-gray-500">
				This app uses a very experimental model. If processing fails, please try again with a
				different image or target.
			</p>
		</div>
	</div>
</div>
