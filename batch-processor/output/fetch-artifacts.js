#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { Octokit } from '@octokit/rest';
import unzipper from 'unzipper';

dotenv.config();       // loads GITHUB_TOKEN from .env

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN missing in .env');

  const owner = 'okechukwu95dev';
  const repo = 'berch-v2';
  const outDir = process.argv[2] || '.'; // Use current directory or specified dir

  // Use run ID from your URL as a direct input
  const runId = 14723964807; // From your URL

  console.log(`🔍 Downloading artifacts from run #${runId} in ${owner}/${repo}`);

  const octokit = new Octokit({
    auth: token
  });

  // Ensure output folder
  await fs.mkdir(outDir, { recursive: true });

  // Get all artifacts from this specific run with pagination
  try {
    // We need to handle pagination manually
    let allArtifacts = [];
    let page = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      console.log(`📄 Fetching page ${page} of artifacts...`);

      const response = await octokit.actions.listWorkflowRunArtifacts({
        owner,
        repo,
        run_id: runId,
        per_page: 100,
        page: page
      });

      const { artifacts, total_count } = response.data;
      console.log(`  Found ${artifacts.length} artifacts on page ${page} (total: ${total_count})`);

      // Add artifacts from this page to our collection
      allArtifacts = allArtifacts.concat(artifacts);

      // Check if we need to get more pages
      if (artifacts.length === 0 || allArtifacts.length >= total_count) {
        hasMorePages = false;
      } else {
        page++;
      }
    }

    console.log(`✅ Found ${allArtifacts.length} total artifacts for run #${runId}`);

    // Print all artifact names for debugging
    console.log(`Artifact names:`);
    allArtifacts.forEach(artifact => {
      console.log(`  - ${artifact.name} (${artifact.size_in_bytes} bytes)`);
    });

    // Filter for all relevant batch artifacts
    const batchArtifacts = allArtifacts.filter(a =>
      a.name.match(/batch-\d+.*results?/)
    );

    console.log(`✅ Found ${batchArtifacts.length} batch artifacts`);

    if (batchArtifacts.length === 0) {
      console.log('❌ No batch artifacts found in this run.');
      return;
    }

    // Create a temporary directory for extraction
    const tempDir = path.join(outDir, `temp_${runId}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Track downloaded artifact count
    let successCount = 0;
    let errorCount = 0;

    // Process each artifact
    for (const artifact of batchArtifacts) {
      console.log(`\n⏬ Processing ${artifact.name} (${artifact.size_in_bytes} bytes)...`);

      try {
        // Download the artifact using fetch directly to get proper binary handling
        const url = `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`;
        const response = await fetch(url, {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to download artifact: ${response.status} ${response.statusText}`);
        }

        // Get response as array buffer
        const arrayBuffer = await response.arrayBuffer();
        // Convert to Buffer properly
        const buffer = Buffer.from(arrayBuffer);

        // Save zip temporarily
        const zipPath = path.join(tempDir, `${artifact.name}.zip`);
        await fs.writeFile(zipPath, buffer);
        console.log(`  💾 Saved zip to ${zipPath}`);

        // Extract the zip
        const artifactExtractDir = path.join(tempDir, artifact.name);
        await fs.mkdir(artifactExtractDir, { recursive: true });

        await unzipper.Open.file(zipPath)
          .then(d => d.extract({ path: artifactExtractDir }));

        console.log(`  📂 Extracted to ${artifactExtractDir}`);

        // Find all files in the extracted directory
        const files = await fs.readdir(artifactExtractDir);
        console.log(`  📄 Files in extract: ${files.join(', ')}`);

        // Find the JSON files
        const jsonFiles = files.filter(file => file.endsWith('.json'));

        if (jsonFiles.length > 0) {
          // Process each JSON file
          for (const jsonFile of jsonFiles) {
            // Determine output filename (standardize batch numbering)
            let outputFileName = artifact.name;

            // If it's a batch artifact, try to standardize the name
            const batchMatch = artifact.name.match(/batch-(\d+)/);
            if (batchMatch && batchMatch[1]) {
              const batchNum = parseInt(batchMatch[1], 10);
              const batchNumPadded = batchNum.toString().padStart(3, '0');
              outputFileName = `batch-${batchNumPadded}.json-results`;
            }

            // Read the JSON file
            const jsonPath = path.join(artifactExtractDir, jsonFile);
            const jsonContent = await fs.readFile(jsonPath, 'utf8');

            // Save to output directory
            const outputPath = path.join(outDir, outputFileName);
            await fs.writeFile(outputPath, jsonContent, 'utf8');

            console.log(`  ✅ Saved as ${outputFileName}`);
            successCount++;
          }
        } else {
          console.log(`  ❌ No JSON files found in artifact ${artifact.name}`);
          errorCount++;
        }
      } catch (err) {
        console.error(`  ❌ Error processing ${artifact.name}:`, err.message);
        errorCount++;
      }
    }

    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true });
      console.log(`🧹 Cleaned up temporary directory`);
    } catch (err) {
      console.warn(`⚠️ Could not clean up temp directory: ${err.message}`);
    }

    console.log(`\n🎉 Finished downloading artifacts:`);
    console.log(`  ✅ Successfully processed: ${successCount}`);
    console.log(`  ❌ Errors: ${errorCount}`);
    console.log(`  📂 Files saved to: ${outDir}`);

  } catch (err) {
    console.error(`❌ Error accessing run #${runId}:`, err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message || err);
  process.exit(1);
});
