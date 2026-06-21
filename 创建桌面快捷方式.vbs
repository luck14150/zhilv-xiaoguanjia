Set objShell = CreateObject("WScript.Shell")
strDesktop = objShell.SpecialFolders("Desktop")
Set objShortcut = objShell.CreateShortcut(strDesktop & "\ZhilvXiaoguanjia.lnk")
objShortcut.TargetPath = "d:\tame al\zhilv-xiaoguanjia\dist\win-unpacked\智律小管家.exe"
objShortcut.WorkingDirectory = "d:\tame al\zhilv-xiaoguanjia\dist\win-unpacked"
objShortcut.WindowStyle = 1
objShortcut.Description = "Zhilv Xiaoguanjia"
objShortcut.Save()
MsgBox "Desktop shortcut created successfully!"
