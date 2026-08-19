#include <windows.h>
#include <userenv.h>
#include <aclapi.h>

#include <iostream>
#include <string>
#include <vector>

#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "userenv.lib")

namespace {

std::wstring quoteArgument(const std::wstring& value) {
  if (value.empty()) return L"\"\"";
  if (value.find_first_of(L" \t\"") == std::wstring::npos) return value;
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (const wchar_t character : value) {
    if (character == L'\\') {
      ++slashes;
      continue;
    }
    if (character == L'\"') {
      result.append(slashes * 2 + 1, L'\\');
      result.push_back(L'\"');
      slashes = 0;
      continue;
    }
    result.append(slashes, L'\\');
    slashes = 0;
    result.push_back(character);
  }
  result.append(slashes * 2, L'\\');
  result.push_back(L'\"');
  return result;
}

HRESULT obtainAppContainerSid(const wchar_t* name, PSID* sid) {
  *sid = nullptr;
  HRESULT result = CreateAppContainerProfile(
    name,
    L"SESAI Offline OCR",
    L"Network-denied local OCR worker",
    nullptr,
    0,
    sid
  );
  if (result == HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)) {
    result = DeriveAppContainerSidFromAppContainerName(name, sid);
  }
  return result;
}

DWORD grantReadExecute(const std::wstring& path, PSID sid) {
  PACL previous = nullptr;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  DWORD result = GetNamedSecurityInfoW(
    const_cast<LPWSTR>(path.c_str()),
    SE_FILE_OBJECT,
    DACL_SECURITY_INFORMATION,
    nullptr,
    nullptr,
    &previous,
    nullptr,
    &descriptor
  );
  if (result != ERROR_SUCCESS) return result;

  EXPLICIT_ACCESSW access{};
  access.grfAccessPermissions = GENERIC_READ | GENERIC_EXECUTE;
  access.grfAccessMode = GRANT_ACCESS;
  access.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
  access.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  access.Trustee.TrusteeType = TRUSTEE_IS_GROUP;
  access.Trustee.ptstrName = static_cast<LPWSTR>(sid);

  PACL updated = nullptr;
  result = SetEntriesInAclW(1, &access, previous, &updated);
  if (result == ERROR_SUCCESS) {
    result = SetNamedSecurityInfoW(
      const_cast<LPWSTR>(path.c_str()),
      SE_FILE_OBJECT,
      DACL_SECURITY_INFORMATION,
      nullptr,
      nullptr,
      updated,
      nullptr
    );
  }
  if (updated) LocalFree(updated);
  if (descriptor) LocalFree(descriptor);
  return result;
}

void printError(const wchar_t* code, DWORD value) {
  std::wcerr << L"{\"errorCode\":\"" << code << L"\",\"win32\":" << value << L"}" << std::endl;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  std::wstring profileName = L"jp.sesai.agentdesktop.ocr";
  std::vector<std::wstring> grantRoots;
  int separator = -1;
  for (int index = 1; index < argc; ++index) {
    const std::wstring argument = argv[index];
    if (argument == L"--") {
      separator = index;
      break;
    }
    if (argument == L"--profile" && index + 1 < argc) {
      profileName = argv[++index];
      continue;
    }
    if (argument == L"--grant-read" && index + 1 < argc) {
      grantRoots.emplace_back(argv[++index]);
      continue;
    }
    printError(L"INVALID_ARGUMENT", ERROR_INVALID_PARAMETER);
    return 64;
  }
  if (separator < 0 || separator + 1 >= argc) {
    printError(L"MISSING_TARGET", ERROR_INVALID_PARAMETER);
    return 64;
  }

  PSID appContainerSid = nullptr;
  const HRESULT profileResult = obtainAppContainerSid(profileName.c_str(), &appContainerSid);
  if (FAILED(profileResult) || appContainerSid == nullptr) {
    printError(L"APPCONTAINER_PROFILE_FAILED", HRESULT_CODE(profileResult));
    return 70;
  }
  for (const auto& root : grantRoots) {
    const DWORD grantResult = grantReadExecute(root, appContainerSid);
    if (grantResult != ERROR_SUCCESS) {
      printError(L"APPCONTAINER_ACL_FAILED", grantResult);
      FreeSid(appContainerSid);
      return 71;
    }
  }

  SIZE_T attributeBytes = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeBytes);
  auto* attributes = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(
    HeapAlloc(GetProcessHeap(), 0, attributeBytes)
  );
  if (!attributes || !InitializeProcThreadAttributeList(attributes, 1, 0, &attributeBytes)) {
    const DWORD error = GetLastError();
    printError(L"ATTRIBUTE_LIST_FAILED", error);
    if (attributes) HeapFree(GetProcessHeap(), 0, attributes);
    FreeSid(appContainerSid);
    return 72;
  }

  SECURITY_CAPABILITIES capabilities{};
  capabilities.AppContainerSid = appContainerSid;
  capabilities.Capabilities = nullptr;
  capabilities.CapabilityCount = 0;
  capabilities.Reserved = 0;
  if (!UpdateProcThreadAttribute(
    attributes,
    0,
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
    &capabilities,
    sizeof(capabilities),
    nullptr,
    nullptr
  )) {
    const DWORD error = GetLastError();
    printError(L"SECURITY_CAPABILITIES_FAILED", error);
    DeleteProcThreadAttributeList(attributes);
    HeapFree(GetProcessHeap(), 0, attributes);
    FreeSid(appContainerSid);
    return 73;
  }

  const std::wstring executable = argv[separator + 1];
  std::wstring commandLine;
  for (int index = separator + 1; index < argc; ++index) {
    if (!commandLine.empty()) commandLine.push_back(L' ');
    commandLine.append(quoteArgument(argv[index]));
  }
  std::vector<wchar_t> mutableCommand(commandLine.begin(), commandLine.end());
  mutableCommand.push_back(L'\0');

  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  for (const HANDLE handle : {
    startup.StartupInfo.hStdInput,
    startup.StartupInfo.hStdOutput,
    startup.StartupInfo.hStdError
  }) {
    if (handle != nullptr && handle != INVALID_HANDLE_VALUE) {
      SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
    }
  }
  startup.lpAttributeList = attributes;
  PROCESS_INFORMATION process{};
  const BOOL created = CreateProcessW(
    executable.c_str(),
    mutableCommand.data(),
    nullptr,
    nullptr,
    TRUE,
    EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW,
    nullptr,
    nullptr,
    &startup.StartupInfo,
    &process
  );
  if (!created) {
    printError(L"APPCONTAINER_PROCESS_FAILED", GetLastError());
    DeleteProcThreadAttributeList(attributes);
    HeapFree(GetProcessHeap(), 0, attributes);
    FreeSid(appContainerSid);
    return 74;
  }

  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD exitCode = 1;
  GetExitCodeProcess(process.hProcess, &exitCode);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  DeleteProcThreadAttributeList(attributes);
  HeapFree(GetProcessHeap(), 0, attributes);
  FreeSid(appContainerSid);
  return static_cast<int>(exitCode);
}
