const { exec } = require('child_process');

function runGitCommands() {
  exec('git add . && git commit -m "image cache" && git push', (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing command: ${error}`);
      return;
    }
    console.log(`stdout: ${stdout}`);
    console.error(`stderr: ${stderr}`);
  });
  setTimeout(()=>{
    runGitCommands()
  }, 600000);
}
runGitCommands()
// Run the function every 1000 milliseconds (1 second)

