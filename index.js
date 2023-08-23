const { spawn } = require('child_process');

function runGitCommands() {
  const command = spawn('sh', ['-c', `git add . && git commit -m "image cache" && git push`]);

  // This will print the output of the command to the console in real-time
  command.stdout.on('data', (data) => {
    console.log(data.toString());
  });

  command.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  command.on('error', (error) => {
    console.error(`Error executing command: ${error}`);
  });

  command.on('close', (code) => {
    if (code !== 0) {
      console.error(`Command exited with code: ${code}`);
    }
    setTimeout(runGitCommands, 15000);
  })
}

runGitCommands();
