#!/usr/bin/env node

/**
 * import-artifacts.js
 * ------------------
 * Imports processed matches from artifact files
 */

const main = async () => {
    const { connect } = await import('../../database.js');
    const fs = await import('fs/promises');
    const path = await import('path');
    
    // Configuration
    const ARTIFACTS_DIR = process.argv[2];
    if (!ARTIFACTS_DIR) {
      console.error('❌ No artifacts directory specified. Usage: node import-artifacts.js <artifacts-dir>');
      process.exit(1);
    }
    
    console.log(`Importing artifacts from: ${ARTIFACTS_DIR}`);
    
    // Connect to database
    const { db, client } = await connect();
    console.log('Connected to database');
    
    // Get all artifact files
    const files = await fs.readdir(ARTIFACTS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    console.log(`Found ${jsonFiles.length} JSON files`);
    
    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalErrors = 0;
    
    // Process each file
    for (const file of jsonFiles) {
      const filePath = path.join(ARTIFACTS_DIR, file);
      console.log(`Processing ${filePath}`);
      
      try {
        // Read and parse the file
        const content = await fs.readFile(filePath, 'utf8');
        const results = JSON.parse(content);
        console.log(`  File contains ${results.length} match results`);
        
        // Process each match in the file
        for (const result of results) {
          totalProcessed++;
          
          try {
            if (result.error) {
              console.log(`  ⚠️ Skipping match ${result.matchId} due to error: ${result.error}`);
              totalErrors++;
              continue;
            }
            
            // Update match status
            await db.collection('matches').updateOne(
              { matchId: result.matchId },
              { 
                $set: {
                  processingStatus: 'complete',
                  date: result.dateInfo?.parsedDate || null,
                  internalId: result.dateInfo?.properInternalId || result.details.internalId,
                  updatedAt: new Date()
                }
              }
            );
            
            // Save match details
            await db.collection('match_details').updateOne(
              { matchId: result.matchId },
              { $set: { ...result.details, updatedAt: new Date() } },
              { upsert: true }
            );
            
            totalSuccessful++;
            
            if (totalProcessed % 100 === 0) {
              console.log(`  Progress: ${totalProcessed} matches processed`);
            }
          } catch (err) {
            console.error(`  ❌ Error processing match ${result.matchId}:`, err.message);
            totalErrors++;
          }
        }
        
        console.log(`  Completed file ${file}`);
        
      } catch (err) {
        console.error(`❌ Error processing file ${file}:`, err.message);
      }
    }
    
    // Print summary
    console.log('\nImport Summary:');
    console.log(`Total processed: ${totalProcessed}`);
    console.log(`Successful: ${totalSuccessful}`);
    console.log(`Errors: ${totalErrors}`);
    
    // Close connection
    await client.close();
    console.log('Database connection closed');
  };
  
  // Run the importer
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });