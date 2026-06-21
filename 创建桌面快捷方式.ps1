$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = $shell.CreateShortcut("$desktop\智律小管家.lnk")
$shortcut.TargetPath = "d:\tame al\zhilv-xiaoguanjia\dist\win-unpacked\智律小管家.exe"
$shortcut.WorkingDirectory = "d:\tame al\zhilv-xiaoguanjia\dist\win-unpacked"
$shortcut.WindowStyle = 1
$shortcut.Description = "Zhilv Xiaoguanjia"
$shortcut.Save()
Write-Host "Desktop shortcut created successfully"
