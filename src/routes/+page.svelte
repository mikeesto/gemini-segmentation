<script lang="ts">
	let selectedFile: File | null = $state(null);
	let finalImageSrc: string | null = $state(null);

	function handleFileInput(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			selectedFile = input.files[0];
		}
	}

	async function handleSubmit() {
		if (!selectedFile) {
			alert('Please select a file to upload.');
			return;
		}

		const formData = new FormData();
		formData.append('file', selectedFile);

		try {
			const response = await fetch('/api/segment', {
				method: 'POST',
				body: formData
			});

			const image = await response.blob();
			console.log('Image:', image);

			const objectUrl = URL.createObjectURL(image);
			finalImageSrc = objectUrl;
		} catch (error) {
			console.error('Error uploading file:', error);
			alert('An error occurred while uploading the file.');
		}
	}
</script>

<h1>Welcome to SvelteKit</h1>

<input
	type="file"
	oninput={handleFileInput}
	class="mb-4 w-full cursor-pointer rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500"
/>
<button
	onclick={handleSubmit}
	class="focus:ring-opacity-50 mb-4 w-full rounded-lg bg-blue-500 px-4 py-2 font-semibold text-white shadow-md transition duration-300 ease-in-out hover:bg-blue-600 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-400"
>
	Upload
</button>
{#if finalImageSrc}
	<div>
		<h2>Segmented Result</h2>
		<!-- Display the final image using the Object URL -->
		<img src={finalImageSrc} alt="Segmented Plant" />
		<!-- Added background for visibility -->
	</div>
{/if}
