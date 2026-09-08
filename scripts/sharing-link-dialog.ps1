Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = 'ZCode Ops - 更新 Sharing Link'
$form.Size = New-Object System.Drawing.Size(720, 220)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(18, 18)
$label.Size = New-Object System.Drawing.Size(670, 42)
$label.Text = '请在 ZCode 中打开 Mobile Remote Control，复制当前 Sharing Link 并粘贴到下方。'
$form.Controls.Add($label)

$input = New-Object System.Windows.Forms.TextBox
$input.Location = New-Object System.Drawing.Point(18, 65)
$input.Size = New-Object System.Drawing.Size(670, 28)
$form.Controls.Add($input)

$save = New-Object System.Windows.Forms.Button
$save.Location = New-Object System.Drawing.Point(520, 115)
$save.Size = New-Object System.Drawing.Size(80, 32)
$save.Text = '保存'
$form.Controls.Add($save)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Location = New-Object System.Drawing.Point(608, 115)
$cancel.Size = New-Object System.Drawing.Size(80, 32)
$cancel.Text = '取消'
$form.Controls.Add($cancel)
$form.CancelButton = $cancel

$save.Add_Click({
  $value = $input.Text.Trim()
  try {
    $uri = [Uri]$value
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'zcode.z.ai' -or $uri.AbsolutePath -ne '/remote/v4' -or
        $value -notmatch '[?&]sid=[^&]+' -or $value -notmatch '[?&]hash=[^&]+' -or $value -notmatch '[?&]mid=[^&]+') { throw 'invalid' }
    [Console]::Out.Write($value)
    $form.Tag = 'saved'
    $form.Close()
  } catch {
    [System.Windows.Forms.MessageBox]::Show('请输入当前 ZCode 生成的完整 Sharing Link。', '链接格式不正确', 'OK', 'Warning') | Out-Null
  }
})
$cancel.Add_Click({ $form.Close() })
$form.Add_Shown({ $input.Focus() })
[void]$form.ShowDialog()
if ($form.Tag -eq 'saved') { exit 0 }
exit 1
